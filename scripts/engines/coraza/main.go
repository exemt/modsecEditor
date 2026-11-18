// Загрузчик правил на библиотеке Coraza — для стенда `scripts/engines`.
//
//	check load <папка>   — каждый *.conf грузится отдельно: загрузился или нет;
//	check run  <папка>   — каждый *.conf грузится, и через него проходит запрос
//	                       из одноимённого *.json: каким кодом он кончился.
//
// Вывод — по строке на файл, поля через табуляцию: имя, итог, сообщение.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/corazawaf/coraza/v3"
)

type request struct {
	Method  string      `json:"method"`
	URI     string      `json:"uri"`
	Headers [][2]string `json:"headers"`
	Body    string      `json:"body"`
}

func flat(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// load грузит файл правил; паника внутри движка — тоже отказ, а не падение стенда.
func load(path string) (waf coraza.WAF, failure string) {
	defer func() {
		if r := recover(); r != nil {
			waf, failure = nil, fmt.Sprintf("panic: %v", r)
		}
	}()
	waf, err := coraza.NewWAF(coraza.NewWAFConfig().WithDirectivesFromFile(path))
	if err != nil {
		return nil, err.Error()
	}
	return waf, ""
}

// run проводит запрос через все фазы и возвращает код, которым он кончился.
func run(waf coraza.WAF, req request) int {
	tx := waf.NewTransaction()
	defer tx.Close()

	tx.ProcessConnection("127.0.0.1", 40000, "127.0.0.1", 8080)
	tx.ProcessURI(req.URI, req.Method, "HTTP/1.1")
	for _, header := range req.Headers {
		tx.AddRequestHeader(header[0], header[1])
	}
	if it := tx.ProcessRequestHeaders(); it != nil {
		return it.Status
	}
	if req.Body != "" {
		if it, _, err := tx.WriteRequestBody([]byte(req.Body)); err == nil && it != nil {
			return it.Status
		}
	}
	if it, err := tx.ProcessRequestBody(); err == nil && it != nil {
		return it.Status
	}
	tx.AddResponseHeader("Content-Type", "text/html")
	if it := tx.ProcessResponseHeaders(200, "HTTP/1.1"); it != nil {
		return it.Status
	}
	if it, err := tx.ProcessResponseBody(); err == nil && it != nil {
		return it.Status
	}
	tx.ProcessLogging()
	return 200
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: check load|run <directory>")
		os.Exit(2)
	}
	mode, dir := os.Args[1], os.Args[2]

	files, _ := filepath.Glob(filepath.Join(dir, "*.conf"))
	sort.Strings(files)
	for _, path := range files {
		name := filepath.Base(path)
		waf, failure := load(path)
		if failure != "" {
			fmt.Printf("%s\tERR\t%s\n", name, flat(failure))
			continue
		}
		if mode == "load" {
			fmt.Printf("%s\tOK\t\n", name)
			continue
		}

		var req request
		spec, err := os.ReadFile(strings.TrimSuffix(path, ".conf") + ".json")
		if err == nil {
			err = json.Unmarshal(spec, &req)
		}
		if err != nil {
			fmt.Printf("%s\tERR\tbad request file: %s\n", name, flat(err.Error()))
			continue
		}
		fmt.Printf("%s\t%d\t\n", name, run(waf, req))
	}
}
