import MagicString from 'magic-string';
import { compile, interpret, preflight } from 'windicss/src';
import { StyleSheet } from 'windicss/src/utils/style';

import { walk, parse } from 'svelte/compiler';

function initStyleList() {
  // make sure list not empty incase reduce error
  return [new StyleSheet()];
}

let IGNORED_CLASSES = [];
let STYLESHEETS = initStyleList();
let DIRECTIVES = initStyleList();
let FILES = [];

let TAGNAMES = {};
let OPTIONS = {
  prefix: 'windi-',
  compile: false,
};

function compilation(classNames) {
  const utility = compile(classNames, OPTIONS.prefix, false);
  IGNORED_CLASSES = [...IGNORED_CLASSES, ...utility.ignored];
  STYLESHEETS.push(utility.styleSheet);
  return [utility.className, ...utility.ignored].join(' ');
}

function interpretation(classNames) {
  const utility = interpret(classNames);
  IGNORED_CLASSES = [...IGNORED_CLASSES, ...utility.ignored];
  const styleSheet = utility.styleSheet;
  styleSheet.children.forEach(style=>{
    style.selector = `windicssGlobal(${style.selector})`; // should be :global, but : will be escape, so we will replace it with :global later
  });
  STYLESHEETS.push(styleSheet);
}

function getReduceValue(node, key="consequent") {
  const value = node[key];
  if (value.raw) return value.value;
  return getReduceValue(value, key);
}

export default function svelteWindicssPreprocess(options={}) {
  OPTIONS = {...OPTIONS, ...options}; // change global settings here;
  return preprocess;
}

function preprocess({content, filename}) {
  let updatedTags = [];
  const parsed = parse(content);
  const code = new MagicString(content);

  walk(parsed.html, {
    enter(node) {
      if (node.type === 'Element' && (!TAGNAMES[node.name])) {
        TAGNAMES[node.name] = filename;
        updatedTags.push(node.name); // only work on production
      };
      if (node.type === 'Class') {
        // handle class directive
        const utility = interpret(node.name);
        IGNORED_CLASSES = [...IGNORED_CLASSES, ...utility.ignored];
        DIRECTIVES.push(utility.styleSheet);
        // make sure directives add after all classes.
      }
      if (node.type==="ConditionalExpression") {
        // handle inline conditional expression
        const utility = interpret(`${getReduceValue(node, 'consequent')} ${getReduceValue(node, 'alternate')}`);
        IGNORED_CLASSES = [...IGNORED_CLASSES, ...utility.ignored];
        DIRECTIVES.push(utility.styleSheet);
      }
      // console.log(node.type);
      if (node.type === 'Attribute' && node.name === 'class') {
        node.value.forEach(({start, end, data}) => {
          if (OPTIONS.compile) {
            // compilation mode
            code.overwrite(start, end, compilation(data));
          } else {
            // interpretation mode
            interpretation(data);
          }
        })
      };
    }
  });

  if (FILES.indexOf(filename) !== -1) {
    // hot reload
    for (let [key,value] of Object.entries(TAGNAMES)) {
      if (value === filename) updatedTags.push(key);
    }
  };

  const preflights = preflight(updatedTags, FILES.length === 0 || FILES.indexOf(filename) === 0); // only enable global styles for first file
  
  preflights.children.forEach(style=>{
    style.selector = `:global(${style.selector})`;
  });
  
  const utilities = STYLESHEETS.reduce((previousValue, currentValue) => previousValue.extend(currentValue)).combine().sort();
  const directives = DIRECTIVES.reduce((previousValue, currentValue) => previousValue.extend(currentValue)).combine().sort();

  let tailwindcss = preflights.extend(utilities).extend(directives).build();
  
  if (!OPTIONS.compile) tailwindcss = tailwindcss.replace(/windicssGlobal\(\\\./g, ':global(.');
  
  if (parsed.css === undefined) {
    code.trimEnd().append(`\n\n<style>\n${tailwindcss}</style>`);
  };

  walk(parsed.css, {
    enter(node) {
      if (node.type === 'Style') {
        code.prependLeft(node.content.start, '\n'+tailwindcss);
      }
    }
  })

  if (!FILES.includes(filename)) FILES.push(filename); // later for judge should update or not
  STYLESHEETS = initStyleList();
  DIRECTIVES = initStyleList();
  IGNORED_CLASSES = [];

  return {code: code.toString()}
}
