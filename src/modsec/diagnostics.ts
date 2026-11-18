/**
 * Замечание так, как его показывает редактор.
 *
 * Находит замечания независимое ядро (`src/seclang`): оно разбирает текст,
 * строит смысл набора и говорит, что не загрузится, что не сработает и что
 * лишнее. Его ответ — код, место в исходнике и подстановки в текст. Этого
 * хватает текстовой вкладке, но не конструктору: там строк нет, и замечание
 * нужно поставить рядом с полем, к которому оно относится.
 *
 * Здесь лежит перевод одного в другое. К замечанию ядра приписывается то,
 * что знает только редактор: файл набора, блок конструктора, звено цепочки и
 * часть правила. Проверок тут нет — кроме одной оговорки самого редактора
 * (`actionNotEditable`): у действия нет поля в форме, и это свойство формы,
 * а не языка.
 *
 * Уровень замечания назначает ядро, и различаются уровни последствием, а
 * не тяжестью формулировки:
 *
 *  - `error` — движок такую конфигурацию не загрузит;
 *  - `warning` — правило загрузится, но сделает не то, что задумано;
 *  - `advice` — правило делает ровно то, что написано; есть способ проще.
 *    Совет не окрашивает сводку и не мешает работать.
 *
 * Закрыта ли визуальная вкладка — вопрос отдельный, и отвечает на него не
 * уровень, а редактор ({@link BLOCKING_CODES}).
 */

import { actionSpec, nodePathAt } from '../seclang';
import { isExclusionCtl } from './exclusions';
import type {
  Diagnostic as CoreDiagnostic,
  DiagnosticCode as CoreCode,
  FileNode,
  Severity,
  Topic,
} from '../seclang';
import type { VisualActions, VisualBlock } from './model';
import type { ParsedStatement } from './types';

export type DiagnosticSeverity = Severity;
export type DiagnosticTopic = Topic;

/**
 * То, что редактор говорит сам, — ядру об этом знать неоткуда.
 *
 *  - `duplicateIdCrossFile` — тот же повтор номера, что и `duplicateId` ядра,
 *    но первый его носитель стоит в другом файле. Редактор знает файлы по
 *    именам и называет, где номер уже занят; и конструктор такой повтор не
 *    закрывает: какой из двух файлов править, выбирает человек.
 *  - `actionNotEditable` — действие верное, но поля для него в форме нет:
 *    править его придётся текстом.
 */
const EDITOR_CODES = {
  duplicateIdCrossFile: ['error', 'structure'],
  actionNotEditable: ['warning', 'structure'],
} as const satisfies Record<string, readonly [Severity, Topic]>;

type EditorCode = keyof typeof EDITOR_CODES;

/** Код диагностики — он же ключ перевода (`diag.<code>`). */
export type DiagnosticCode = CoreCode | EditorCode;

/** Часть правила, к которой относится сообщение. */
export type DiagnosticSlot = 'targets' | 'transforms' | 'operator' | 'actions';

/**
 * Адрес диагностики в модели конструктора.
 *
 * Номер строки годится текстовой вкладке, но в конструкторе строк нет:
 * там нужно подсветить конкретное поле. Поэтому адрес хранится отдельно
 * от `line` и в терминах модели, а не исходника.
 */
export interface DiagnosticAnchor {
  /** Ключ блока (`VisualBlock.key`): правила, действия, метки или директивы. */
  ruleKey: string;
  /**
   * Номер звена цепочки, 1-based. Задан только у правил с несколькими
   * условиями: у одиночного правила «условие 1» — лишний шум.
   */
  condition?: number;
  slot?: DiagnosticSlot;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  topic: DiagnosticTopic;
  code: DiagnosticCode;
  /** Подстановки в текст сообщения. */
  params?: Record<string, string>;
  /**
   * Файл набора, к которому относится диагностика.
   *
   * Строка и ключ правила считаются внутри файла, поэтому без него замечание
   * из одного файла открывалось бы в другом. У одинокого документа файла нет.
   */
  file?: string;
  /** Строка исходника (1-based), к которой относится диагностика. */
  line?: number;
  anchor?: DiagnosticAnchor;
  /**
   * Границы в исходнике файла: `start` включён, `end` исключён.
   *
   * Есть у всего, что нашло ядро: по ним оно выводит исправление. У оговорок
   * самого редактора границ нет — чинить в тексте там нечего.
   */
  range?: { start: number; end: number };
}

/**
 * Замечания, с которыми файл нельзя показать в конструкторе.
 *
 * Конструктор работает только с записью, которую может показать формой и
 * собрать обратно тем же правилом: притворяться, что он понимает сломанный
 * текст, — худший из возможных вариантов. Таких случаев немного, и все они
 * про форму записи, а не про её смысл:
 *
 *  - запись прочитана не так, как написана: непарная кавычка, пробел после
 *    переноса — аргументы разрезаны не там, где хотел автор;
 *  - у правила нет того, на чём держится форма: областей проверки, оператора,
 *    продолжения цепочки, номера;
 *  - директива не дописана или не названа: формы у неё нет, а строка, с
 *    которой конфигурация не загрузится, не должна выглядеть готовой.
 *
 * Список задан здесь, а не выведен из уровня замечания, и это намеренно.
 * Уровень отвечает на другой вопрос — загрузит ли запись движок, — и ответ на
 * него у движков разный: шаблон, который не собирается, не загрузит ни один,
 * а конструктору он не мешает ничем — поле краснеет, и чинят его там же, где
 * набрали. Закрывай вкладку любая ошибка, человек, набравший в форме
 * недописанный шаблон, оказался бы заперт перед ней.
 *
 * Повтор номера входит сюда только внутри файла: через файлы это беда
 * набора (`duplicateIdCrossFile`), и какой из двух править, выбирает человек.
 */
export const BLOCKING_CODES: readonly CoreCode[] = [
  'unbalancedQuotes',
  'continuationSpace',
  'emptyTargets',
  'unknownOperator',
  'danglingChain',
  'chainLinkHeadAction',
  'missingId',
  'duplicateId',
  'unknownDirective',
  'directiveArgCount',
  'directiveValueMissing',
  'directiveNotNumber',
  'exclusionNoTarget',
  'exclusionBadId',
];

/* ------------------------------------------------------------------ */
/* Место замечания в модели конструктора                               */
/* ------------------------------------------------------------------ */

/** Файл в том виде, в котором его читает перевод замечаний. */
export interface DiagnosticView {
  /** Как файл назвать в замечании; у одинокого документа его нет. */
  file?: string;
  /** Дерево, по которому замечания найдены: в нём ищется часть правила. */
  tree: FileNode;
  statements: readonly ParsedStatement[];
  blocks: readonly VisualBlock[];
}

/** Блок и звено, которым принадлежит утверждение. */
interface Place {
  key: string;
  condition?: number;
}

/**
 * Раскладка «утверждение → блок конструктора».
 *
 * Описание над блоком относится к нему же: замечание о комментарии — о
 * пометке линтера, которой нечего снимать, — должно встать под тем правилом,
 * над которым она написана.
 */
function placesOf(blocks: readonly VisualBlock[]): Map<number, Place> {
  const places = new Map<number, Place>();

  for (const block of blocks) {
    if (block.kind !== 'rule') {
      for (let i = block.startIndex; i <= block.statementIndex; i++) {
        places.set(i, { key: block.key });
      }
      continue;
    }

    const { rule } = block;
    for (let i = rule.startIndex; i <= rule.tailIndex; i++) places.set(i, { key: block.key });
    // «Условие 1» у правила без цепочки — лишнее уточнение.
    if (rule.conditions.length > 1) {
      rule.conditions.forEach((condition, position) => {
        places.set(condition.statementIndex, { key: block.key, condition: position + 1 });
      });
    }
  }
  return places;
}

/** Индекс утверждения, занимающего строку; строки документа идут подряд. */
function statementAtLine(statements: readonly ParsedStatement[], line: number): number {
  let low = 0;
  let high = statements.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const { span } = statements[middle];
    if (line < span.startLine) high = middle - 1;
    else if (line > span.endLine) low = middle + 1;
    else return middle;
  }
  return -1;
}

/**
 * Замечания, место которых ядро называет именем директивы, а относятся они
 * к части правила: области проверки, которых нет, показать больше не на чем.
 */
const SLOT_BY_CODE: Partial<Record<CoreCode, DiagnosticSlot>> = {
  emptyTargets: 'targets',
};

/**
 * Часть правила, в которую попадает смещение.
 *
 * Ядро ставит замечание на тот узел, о котором говорит: на область проверки,
 * на шаг конвейера, на аргумент оператора. Отдельной таблицы «код → часть
 * правила» поэтому не нужно — и новая проверка ядра встанет в конструкторе
 * на своё место сама.
 */
function slotAt(tree: FileNode, offset: number): DiagnosticSlot | undefined {
  let slot: DiagnosticSlot | undefined;
  for (const node of nodePathAt(tree, offset)) {
    if (node.kind === 'VariableList') return 'targets';
    if (node.kind === 'Operator') return 'operator';
    if (node.kind === 'ActionList') slot = 'actions';
    else if (node.kind === 'Transform') return 'transforms';
  }
  return slot;
}

/**
 * Переводит замечания ядра об одном файле в замечания редактора.
 *
 * Порядок сохраняется: ядро отдаёт их сверху вниз по исходнику.
 */
export function toDiagnostics(
  found: readonly CoreDiagnostic[],
  view: DiagnosticView,
): Diagnostic[] {
  if (found.length === 0) return [];
  const places = placesOf(view.blocks);

  return found.map((item) => {
    const place = places.get(statementAtLine(view.statements, item.line));
    const slot = SLOT_BY_CODE[item.code] ?? slotAt(view.tree, item.start);

    const diagnostic: Diagnostic = {
      severity: item.severity,
      topic: item.topic,
      code: item.code,
      params: item.data,
      file: view.file,
      line: item.line,
      range: { start: item.start, end: item.end },
    };
    if (place !== undefined) {
      diagnostic.anchor = { ruleKey: place.key };
      if (place.condition !== undefined) diagnostic.anchor.condition = place.condition;
      if (slot !== undefined) diagnostic.anchor.slot = slot;
    }
    return diagnostic;
  });
}

/* ------------------------------------------------------------------ */
/* Оговорки самого редактора                                           */
/* ------------------------------------------------------------------ */

function editorDiagnostic(
  code: EditorCode,
  place: { file?: string; line?: number; anchor?: DiagnosticAnchor },
  params: Record<string, string>,
): Diagnostic {
  const [severity, topic] = EDITOR_CODES[code];
  return { severity, topic, code, params, ...place };
}

/**
 * Действия, для которых в форме конструктора нет поля.
 *
 * Правило с ними верное — ядру сказать о нём нечего. Но человеку, который
 * открыл карточку, важно знать, что часть правила в ней только показана:
 * править её придётся текстом. Исключения `ctl` сюда не входят — их
 * конструктор правит полями. Незнакомое имя тоже: о нём уже сказало ядро
 * (`unknownAction`), и вторая запись о той же строке прятала бы опечатку
 * среди оговорок. Что имя знакомо, решает каталог ядра — тогда о каждом
 * таком действии сказано ровно одно из двух.
 */
export function editorNotes(view: Omit<DiagnosticView, 'tree'>): Diagnostic[] {
  const notes: Diagnostic[] = [];

  const note = (key: string, statementIndex: number, actions: VisualActions) => {
    for (const action of actions.extra) {
      if (isExclusionCtl(action) || actionSpec(action.name) === null) continue;
      notes.push(
        editorDiagnostic(
          'actionNotEditable',
          {
            file: view.file,
            line: view.statements[statementIndex]?.span.startLine,
            anchor: { ruleKey: key, slot: 'actions' },
          },
          { name: action.name },
        ),
      );
    }
  };

  for (const block of view.blocks) {
    if (block.kind === 'rule') note(block.key, block.rule.headIndex, block.rule.actions);
    else if (block.kind === 'action') note(block.key, block.statementIndex, block.actions);
  }
  return notes;
}

/** Где номер правила занят впервые: файл, его имя и строка. */
export interface IdHolder {
  file: string;
  name: string;
  line?: number;
}

/**
 * Повторы номера, первый носитель которого стоит в другом файле.
 *
 * Ядро называет лишним то из двух правил, что загружено позже, и говорит об
 * этом одним кодом, где бы ни стояло первое. Редактор различает: повтор
 * внутри файла чинится в нём же и закрывает конструктор, а повтор через
 * файлы — вопрос к набору. Такое замечание получает свой код и адрес
 * первого носителя: «уже занят в rules.conf, строка 12».
 *
 * `holders` — первый носитель каждого номера в наборе, `local` — ключи
 * блоков, чей номер уже встречался выше в их собственном файле.
 */
export function markCrossFileIds(
  diagnostics: readonly Diagnostic[],
  file: string,
  holders: ReadonlyMap<string, IdHolder>,
  local: ReadonlySet<string>,
): Diagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.code !== 'duplicateId') return diagnostic;
    const id = diagnostic.params?.id;
    const holder = id === undefined ? undefined : holders.get(id);
    const key = diagnostic.anchor?.ruleKey;
    if (id === undefined || holder === undefined || holder.file === file) return diagnostic;
    if (key !== undefined && local.has(key)) return diagnostic;

    return editorDiagnostic(
      'duplicateIdCrossFile',
      { file: diagnostic.file, line: diagnostic.line, anchor: diagnostic.anchor },
      { id, file: holder.name, line: String(holder.line ?? '') },
    );
  });
}

/**
 * Замечания в порядке набора, а не в порядке проверок.
 *
 * Читать удобнее так: сначала всё про первое правило, потом про второе. Когда
 * файлов несколько, первым словом идёт порядок включения: список замечаний
 * читают сверху вниз, и файл, прыгающий от строки к строке, превращает один
 * список в несколько. Сортировка устойчива, поэтому у сообщений об одной
 * строке сохраняется порядок, в котором их отдало ядро.
 */
export function byLine(
  diagnostics: readonly Diagnostic[],
  order?: ReadonlyMap<string, number>,
): Diagnostic[] {
  const place = (file?: string) => (order === undefined ? 0 : (order.get(file ?? '') ?? 0));
  return [...diagnostics].sort(
    (a, b) => place(a.file) - place(b.file) || (a.line ?? 0) - (b.line ?? 0),
  );
}
