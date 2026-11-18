/**
 * Окружение: что в остальном наборе делает правило бесполезным.
 *
 * Правило может быть безупречным и при этом не работать — потому что тело
 * запроса не читается, движок переведён в режим наблюдения или переменная
 * заполняется только после действия, которого в наборе нет. Причина здесь
 * всегда в другой строке, а то и в другом файле.
 *
 * Сюда же отнесены значения директив: это настройки, от которых зависит всё
 * остальное, и опечатка в них стоит дороже, чем в правиле.
 */

import { directiveSpec, operatorSpec } from '../../catalog';
import type { DirectiveNode, VariableNode } from '../../ast';
import type { Check } from '../engine';

/** Переменные, которые заполняются только при разборе тела запроса. */
const REQUEST_BODY = new Set([
  'REQUEST_BODY',
  'REQUEST_BODY_LENGTH',
  'ARGS_POST',
  'ARGS_POST_NAMES',
  'FILES',
  'FILES_NAMES',
  'FILES_SIZES',
  'FILES_TMPNAMES',
  'MULTIPART_STRICT_ERROR',
  'REQBODY_ERROR',
  'XML',
]);

export const environment: Check = {
  name: 'environment',
  create({ model, file, options, report }) {
    const { scope } = model;
    const { settings } = scope;
    // Каталог на диске нужен коллекциям только во второй версии: третья
    // держит их в памяти, а у Coraza долгоживущих коллекций нет вовсе.
    const needsDataDir = options.engine === undefined || options.engine === 'modsecurity2';
    const { files } = options;
    const from = scope.names.get(file);
    const exists = (path: string): boolean => {
      if (files === undefined) return true;
      if (typeof files === 'function') return files(path, from);
      return files.includes(path);
    };

    let xmlSaid = false;
    let geoSaid = false;
    let dataSaid = false;
    let dbSaid = false;

    const bodyOff = settings.requestBodyAccess === false && !scope.bodyAccessCtl;
    const responseOff = settings.responseBodyAccess === false && !scope.bodyAccessCtl;

    return {
      Variable(node: VariableNode) {
        if (node.exclude) return;
        const name = node.name.toUpperCase();
        const at = { start: node.nameStart, end: node.nameEnd };

        if (bodyOff && REQUEST_BODY.has(name)) report('requestBodyAccessOff', at, { name: node.name });
        if (responseOff && name === 'RESPONSE_BODY') {
          report('responseBodyAccessOff', at, { name: node.name });
        }

        // Одного раза на файл хватает: причина одна, и чинится она одной
        // строкой где-то ещё.
        if (name === 'XML' && !scope.xmlProcessor && !xmlSaid) {
          xmlSaid = true;
          report('xmlWithoutProcessor', at);
        }
        if (name === 'GEO' && !scope.geoLookup && !geoSaid) {
          geoSaid = true;
          report('geoWithoutLookup', at);
        }
      },

      // Одного раза на файл хватает и здесь: каталог и база задаются одной
      // строкой, и скорее всего — в файле настройки сервера.
      Action(node) {
        if (!needsDataDir || dataSaid || settings.dataDir) return;
        if (node.name.toLowerCase() !== 'initcol') return;
        const text = node.value === null ? '' : node.value.value;
        const equals = text.indexOf('=');
        if (equals <= 0) return;
        dataSaid = true;
        report('persistentWithoutDataDir', node, { name: text.slice(0, equals) });
      },

      Operator(node) {
        // Файлы данных: имён может быть несколько, адрес в сети — не файл.
        if (files !== undefined && operatorSpec(node.name)?.arg === 'file') {
          if (node.argument.macros.length === 0) {
            for (const path of node.argument.value.trim().split(/\s+/)) {
              if (path === '' || /^https?:\/\//i.test(path) || exists(path)) continue;
              report('fileNotFound', node.argument, { path });
            }
          }
        }

        if (dbSaid || settings.geoDb || node.name.toLowerCase() !== 'geolookup') return;
        dbSaid = true;
        report('geoLookupWithoutDb', node.implicit ? node : { start: node.nameStart, end: node.nameEnd });
      },

      end() {
        // Стоит замечание у самой директивы, пусть правила и в другом файле:
        // режим правят там, а не у правила, которое из-за него молчит.
        const engine = settings.ruleEngine;
        if (engine === null || engine.file !== file || !scope.blocking) return;
        const mode = engine.value.toLowerCase();
        if (mode === 'detectiononly' || mode === 'off') {
          report('engineNotEnforcing', engine.node, { mode: engine.value });
        }
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Значения директив                                                   */
/* ------------------------------------------------------------------ */

export const directives: Check = {
  name: 'directives',
  create({ options, report }) {
    return {
      Directive(node: DirectiveNode) {
        // Относительный путь в `Include` Apache отсчитывает от ServerRoot, а
        // третья версия и Coraza — от папки файла, где стоит `Include`
        // (проба `f-include-relative`: файл рядом нашли все, кроме второй
        // версии). Путь от корня читается одинаково всеми.
        if (/^Include(?:Optional)?$/i.test(node.name)) {
          const target = node.args[0];
          const fromFile = options.engine === 'modsecurity3' || options.engine === 'coraza';
          const absolute = target === undefined || /^(?:\/|[A-Za-z]:[\\/])/.test(target.value);
          if (!fromFile && !absolute && target.value !== '') {
            report('includeRelative', target, { path: target.value });
          }
          return;
        }
        const spec = directiveSpec(node.name);
        if (spec === null) return;
        const { name } = node;
        const first = node.args[0];

        if (spec.kind === 'none') {
          if (node.argCount > 0) {
            report('directiveArgCount', node, { name, count: String(node.argCount) });
          }
          return;
        }
        if (first === undefined) {
          report('directiveValueMissing', { start: node.start, end: node.nameEnd }, { name });
          return;
        }
        // У директив с одним значением второе — почти всегда забытые кавычки.
        if (spec.kind !== 'text' && spec.kind !== 'list' && node.argCount > 1) {
          report('directiveArgCount', node, { name, count: String(node.argCount) });
          return;
        }

        const value = first.value;
        switch (spec.kind) {
          case 'choice':
            if (!spec.values.some((allowed) => allowed.toLowerCase() === value.toLowerCase())) {
              report('directiveBadValue', first, { name, value });
            } else if (/^SecRequestBodyLimitAction$/i.test(name) && /^ProcessPartial$/i.test(value)) {
              // Всё, что дальше предела, не проверяется ни одним движком
              // (сценарий `body-partial-bypass`): набить тело мусором до
              // предела и дописать атаку — и она пройдёт мимо правил.
              report('partialBodyInspection', first);
            }
            break;
          case 'number':
            if (!/^\d+$/.test(value)) report('directiveNotNumber', first, { name, value });
            break;
          case 'level':
            if (!/^[0-9]$/.test(value)) report('directiveBadValue', first, { name, value });
            break;
          case 'mode':
            if (!/^(?:0?[0-7]{3,4}|default)$/i.test(value)) {
              report('directiveBadValue', first, { name, value });
            }
            break;
          case 'parts':
            for (const letter of value) {
              if (!/[A-KZ]/i.test(letter)) {
                report('directiveUnknownFlag', first, { value: letter });
                break;
              }
            }
            break;
          default:
            break;
        }
      },
    };
  },
};
