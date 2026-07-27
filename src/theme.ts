import { createTheme } from '@mui/material/styles';

/**
 * Высота управляющего элемента строки: поля, переключателя, набора чипов.
 *
 * Конструктор читается как таблица, поэтому все элементы одной строки
 * обязаны совпадать по высоте. Значение нужно не только теме: скобки связок
 * и кнопки, вынесенные из потока сетки, встают на линию полей по этому же
 * числу — иначе они уезжают на пару пикселей и вертикали ломаются.
 */
export const CONTROL_HEIGHT = 32;

/**
 * Горизонтальный отступ внутри поля.
 *
 * По нему выравнивается всё содержимое — текст, чипы, плавающая подпись, —
 * поэтому левые края соседних полей совпадают независимо от начинки. Поле,
 * которое собирает содержимое само, обязано брать отступ отсюда: иначе оно
 * встанет в общий ряд со сдвигом в пару пикселей.
 */
export const FIELD_GUTTER = 10;

/**
 * Скругление углов. Правило ModSecurity — техническая конструкция из
 * прямоугольных блоков, и мягкие овалы её только размывают: чем ближе
 * элементы к прямоугольнику, тем очевиднее, что они лежат в одной сетке.
 */
const RADIUS = 4;

/** Внутренняя высота поля: то, что остаётся под содержимое без рамки. */
const CONTENT_HEIGHT = CONTROL_HEIGHT - 2;

/** Строка текста в поле при базовом кегле — по ней считаются отступы. */
const LINE_HEIGHT = 19;

/** Вертикальный отступ, доводящий строку текста до высоты элемента. */
const PAD_Y = (CONTENT_HEIGHT - LINE_HEIGHT) / 2;

/**
 * Тёмная тема конструктора.
 *
 * Цвета — смысловые, а не декоративные: оранжевый закреплён за областями
 * проверки и связкой ИЛИ, красный — за связкой И и разрушающими действиями,
 * бирюзовый — за операторами сравнения, фиолетовый — за преобразованиями.
 * Один и тот же цвет означает одно и то же в любом месте интерфейса.
 *
 * Размеры собраны здесь целиком и намеренно: стандартные отступы MUI
 * рассчитаны на формы в полстраницы, а здесь в одну строку укладывается
 * целая директива. Задавать компактность на каждом поле по отдельности
 * значит гарантированно получить поля разной высоты — что и случилось с
 * исключениями, — поэтому плотность задаётся один раз для всего проекта.
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#181b21', paper: '#22262e' },
    primary: { main: '#8b7ce8', light: '#b9a9ff' },
    secondary: { main: '#3fd0c9', light: '#7fe3dd' },
    error: { main: '#e05a4f', light: '#f08a80' },
    warning: { main: '#e8974a', light: '#f0b070' },
    success: { main: '#5ab98a' },
    divider: 'rgba(255,255,255,0.12)',
    text: { primary: '#e6e8ec', secondary: '#98a1b0' },
  },
  shape: { borderRadius: RADIUS },
  typography: { fontSize: 13 },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },

    // Размер полей не оставлен на усмотрение места вызова: «small» —
    // единственный размер, в котором строка условия остаётся строкой.
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiAutocomplete: {
      defaultProps: { size: 'small' },
      // Autocomplete считает отступы поля сам, поверх обычного поля ввода.
      // Повторяем его же селектор, чтобы список переменных не оказался
      // выше соседних полей.
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root.MuiInputBase-sizeSmall': {
            paddingTop: PAD_Y,
            paddingBottom: PAD_Y,
            paddingLeft: FIELD_GUTTER - 4,
            '& .MuiAutocomplete-input': { padding: '0 4px' },
          },
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        // Размер поля здесь читается из `ownerState`, а не из класса: у
        // самого `input` класса размера нет, MUI различает размеры только
        // вариантами. У многострочного поля отступы держит корпус, а не
        // сам `textarea`, — ему padding задавать нельзя, он сложится с
        // корпусом и текст уедет от рамки вдвое дальше.
        input: ({ ownerState }) => ({
          ...(ownerState.size === 'small' && !ownerState.multiline
            ? { padding: `${PAD_Y}px ${FIELD_GUTTER}px` }
            : {}),
          // Браузер красит автозаполненное поле своим жёлтым или синим
          // фоном раньше, чем применяются любые из наших цветов, и поле
          // выпадает из тёмной темы. Настоящей заливки у автозаполнения
          // нет — есть только цвет перехода, — поэтому здесь он растянут
          // на часы: фон остаётся тем же, что и у пустого поля, сколько бы
          // поле ни было заполнено.
          '&:-webkit-autofill': {
            WebkitTextFillColor: '#e6e8ec',
            caretColor: '#e6e8ec',
            transition: 'background-color 600000s ease-in-out 0s',
          },
        }),
        root: {
          '&.MuiInputBase-adornedStart': { paddingLeft: FIELD_GUTTER },
          '&.MuiInputBase-adornedEnd': { paddingRight: FIELD_GUTTER - 4 },
        },
      },
    },

    // Плавающая подпись едет вслед за отступом поля: в свёрнутом виде она
    // стоит на месте будущего текста, в развёрнутом — в разрыве рамки.
    MuiInputLabel: {
      styleOverrides: {
        sizeSmall: {
          transform: `translate(${FIELD_GUTTER}px, ${PAD_Y}px) scale(1)`,
          '&.MuiInputLabel-shrink': {
            transform: `translate(${FIELD_GUTTER}px, -9px) scale(0.75)`,
          },
        },
      },
    },

    MuiButton: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        // Кнопки конструктора подписаны по-русски и длинной подписи им
        // хватает: резерв в 64px из умолчаний MUI только раздувает строку.
        sizeSmall: { padding: '2px 8px', minWidth: 0 },
      },
    },

    // Иконочные кнопки квадратные, а не круглые: они стоят в колонках
    // сетки, и круглая подсветка при наведении выпадает из этих колонок.
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { sizeSmall: { padding: 4, borderRadius: RADIUS } },
    },

    // Кнопка внутри поля не задаёт его высоту. Иконка с полями кнопки выше
    // строки текста, и поле значения с карандашом становилось на пять
    // пикселей выше соседей — строка условия переставала читаться таблицей.
    // Кнопка забирает вертикальные поля поля ввода себе: в габарит она
    // укладывается и без них, а высоту теперь задаёт только строка текста.
    MuiInputAdornment: {
      styleOverrides: {
        root: {
          '& .MuiIconButton-root': { marginTop: -PAD_Y, marginBottom: -PAD_Y },
        },
      },
    },

    MuiToggleButton: {
      styleOverrides: {
        sizeSmall: { height: CONTROL_HEIGHT, padding: `0 ${FIELD_GUTTER - 2}px` },
        // Включённое состояние держится на цвете, а не на подсветке фона:
        // серая заливка из умолчаний в тёмной теме почти не отличается от
        // выключенной кнопки, и по переключателю нельзя сказать, действует
        // он сейчас или нет. Цвет задаётся на месте — `error` у отрицания,
        // `success` у подсчёта, — и рамка подхватывает его же.
        root: { '&.Mui-selected': { borderColor: 'currentColor' } },
      },
    },

    // Чип — это значение списка, а не ярлык: он стоит внутри поля рядом с
    // текстом, поэтому повторяет его форму, а не форму таблетки.
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        sizeSmall: { height: 22, borderRadius: RADIUS - 1 },
        label: ({ ownerState }) =>
          ownerState.size === 'small' ? { paddingLeft: 6, paddingRight: 6 } : {},
        deleteIcon: ({ ownerState }) =>
          ownerState.size === 'small' ? { fontSize: 15, marginRight: 3 } : {},
      },
    },
  },
});
