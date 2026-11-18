import { ACTIONS, DIRECTIVES } from '../components/syntax/modsecKeywords';
import {
  actionSpec,
  directiveName,
  operatorSpec,
  transformSpec,
  variableSpec,
} from '../seclang';
import { DIRECTIVE_FORM_NAMES } from './directives';
import {
  AUDIT_FLAGS,
  DISRUPTIVE_ACTIONS,
  LOG_FLAGS,
  OPERATOR_META,
  TRANSFORM_META,
  VARIABLE_META,
} from './semantics';

/**
 * Таблицы редактора и каталог ядра — два описания одного языка.
 *
 * Разбирает и проверяет правила ядро (`src/seclang`), а формы конструктора
 * по-прежнему живут на своих таблицах: в них подписи, подсказки и порядок
 * полей, которых ядру знать незачем. Разойтись им нельзя в двух местах.
 *
 * Первое — написание имён. Разбор приводит имя к тому, как оно записано в
 * каталоге ядра, а форма ищет его в своей таблице буква в букву: имя, которое
 * таблицы пишут по-разному, конструктор показал бы незнакомым.
 *
 * Второе — устройство: коллекция ли переменная, с какой фазы она заполнена,
 * что принимает оператор. Форма, которая разрешает то, о чём линтер тут же
 * скажет «так нельзя», хуже формы, которая молчит.
 */

describe('имена: таблицы редактора пишут их так же, как каталог ядра', () => {
  it('переменные', () => {
    for (const name of Object.keys(VARIABLE_META)) {
      expect([name, variableSpec(name)?.name]).toEqual([name, name]);
    }
  });

  it('операторы', () => {
    for (const name of Object.keys(OPERATOR_META)) {
      expect([name, operatorSpec(name)?.name]).toEqual([name, name]);
    }
  });

  it('преобразования', () => {
    for (const name of Object.keys(TRANSFORM_META)) {
      expect([name, transformSpec(name)?.name]).toEqual([name, name]);
    }
  });

  it('действия, которые конструктор раскладывает по полям', () => {
    const fields = [
      'id',
      'phase',
      'status',
      'msg',
      'logdata',
      'severity',
      'ver',
      'rev',
      'maturity',
      'accuracy',
      'tag',
      'setvar',
      'capture',
      't',
      'chain',
      'ctl',
      'skipAfter',
      ...DISRUPTIVE_ACTIONS,
      ...LOG_FLAGS,
      ...AUDIT_FLAGS,
    ];
    for (const name of fields) {
      expect([name, actionSpec(name)?.name]).toEqual([name, name]);
    }
  });

  it('действия из базы ключевых слов', () => {
    // База шире каталога в одну сторону — подсказке позволено знать больше;
    // но то, что знают оба, записано одинаково.
    for (const name of ACTIONS) {
      const spec = actionSpec(name);
      if (spec !== null) expect([name, spec.name]).toEqual([name, name]);
    }
  });

  it('директивы', () => {
    for (const name of [...DIRECTIVES, ...DIRECTIVE_FORM_NAMES]) {
      const known = directiveName(name);
      if (known !== null) expect([name, known]).toEqual([name, name]);
    }
    // Директива, для которой у редактора есть форма, обязана быть и в ядре:
    // иначе он сам предлагал бы строку, которую линтер назовёт незнакомой.
    for (const name of DIRECTIVE_FORM_NAMES) {
      expect([name, directiveName(name)]).toEqual([name, name]);
    }
  });
});

describe('устройство: каталог ядра согласен с таблицами редактора', () => {
  it('знает все переменные редактора и согласен с ним об их устройстве', () => {
    for (const [name, meta] of Object.entries(VARIABLE_META)) {
      const spec = variableSpec(name);
      expect({ name, known: spec !== null }).toEqual({ name, known: true });
      // Редактор знает одну фазу — ту, с которой переменная заполнена целиком.
      // Ядро различает ещё и ту, с которой в ней есть хоть что-то: в `ARGS`
      // параметры строки запроса видны уже в первой.
      expect([name, spec?.collection, spec?.selector, spec?.fullPhase]).toEqual([
        name,
        meta.collection,
        meta.selector,
        meta.minPhase,
      ]);
      // Хранилища ядро честно называет неизвестным видом; в остальном —
      // то же, что в редакторе.
      if (spec?.value !== 'any') expect([name, spec?.value]).toEqual([name, meta.value]);
    }
  });

  it('знает все операторы редактора', () => {
    for (const [name, meta] of Object.entries(OPERATOR_META)) {
      expect([name, operatorSpec(name)?.arg]).toEqual([name, meta.arg]);
    }
  });

  it('знает все преобразования редактора', () => {
    // Кодирование в текст редактор относит к «не тексту»; ядро различает
    // сырые байты и текст известного алфавита, и для него это строка.
    const encoders = new Set(['hexEncode', 'base64Encode']);

    for (const [name, meta] of Object.entries(TRANSFORM_META)) {
      const spec = transformSpec(name);
      expect({ name, known: spec !== null }).toEqual({ name, known: true });
      expect([name, spec?.resets]).toEqual([name, meta.resets]);
      if (!meta.resets && !encoders.has(name)) {
        const produces = spec?.produces === 'same' ? 'string' : spec?.produces;
        expect([name, produces]).toEqual([name, meta.produces]);
      }
    }
  });
});
