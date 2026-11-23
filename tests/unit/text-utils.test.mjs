import { test } from 'node:test';
import assert from 'node:assert/strict';

const U = await import('../../src/content/core/text-utils.js');

test('upper and lower case', () => {
  assert.equal(U.upperCase('Hello wörld ß'), 'HELLO WÖRLD SS');
  assert.equal(U.lowerCase('HeLLo WÖRLD'), 'hello wörld');
});

test('capitalize first letter: start of every sentence, rest untouched', () => {
  assert.equal(U.capitalizeFirstLetter('hello world. this is it! ok? yes'), 'Hello world. This is it! Ok? Yes');
  assert.equal(U.capitalizeFirstLetter('first line\nsecond line'), 'First line\nSecond line');
  assert.equal(U.capitalizeFirstLetter('"quoted start" and iPhone'), '"Quoted start" and iPhone');
  assert.equal(U.capitalizeFirstLetter('3.5 is a number. but this is not'), '3.5 is a number. But this is not');
  assert.equal(U.capitalizeFirstLetter(''), '');
});

test('capitalize each word', () => {
  assert.equal(U.capitalizeEachWord('hELLO wORLD from the web'), 'Hello World From The Web');
  assert.equal(U.capitalizeEachWord("don't stop, élan vital"), "Don't Stop, Élan Vital");
  assert.equal(U.capitalizeEachWord('one\ntwo   three'), 'One\nTwo   Three');
});

test('remove extra spaces keeps line breaks and trims every line', () => {
  assert.equal(U.removeExtraSpaces('  hello    big   world  \n\n   next\t\tline   '), 'hello big world\n\nnext line');
  assert.equal(U.removeExtraSpaces('a  b'), 'a b');
  assert.equal(U.removeExtraSpaces('   '), '');
});

test('replace space with - or _ (a run counts once, lines are kept)', () => {
  assert.equal(U.spacesToDash('hello   big world'), 'hello-big-world');
  assert.equal(U.spacesToUnderscore('hello big\nnew line'), 'hello_big\nnew_line');
  assert.equal(U.spacesToDash('nospace'), 'nospace');
});

test('find & replace: plain text is literal, regex is opt-in, $ stays a dollar sign', () => {
  assert.deepEqual(U.findReplace('a.b a.b axb', 'a.b', 'X'), { text: 'X X axb', count: 2 });
  assert.deepEqual(U.findReplace('Cat cat CAT', 'cat', 'dog'), { text: 'dog dog dog', count: 3 });
  assert.deepEqual(U.findReplace('Cat cat CAT', 'cat', 'dog', { matchCase: true }), { text: 'Cat dog CAT', count: 1 });
  assert.deepEqual(U.findReplace('price', 'price', '$5 & $&'), { text: '$5 & $&', count: 1 });
  assert.deepEqual(U.findReplace('2024-05-06', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { regex: true }), { text: '06/05/2024', count: 1 });
  assert.deepEqual(U.findReplace('abc', 'x', 'y'), { text: 'abc', count: 0 });
  assert.deepEqual(U.findReplace('abc', 'b', ''), { text: 'ac', count: 1 });
  assert.ok(U.findReplace('abc', '(', 'x', { regex: true }).error);
  assert.ok(U.findReplace('abc', '', 'x').error);
});

test('text statistics', () => {
  assert.deepEqual(U.textStats(''), { chars: 0, words: 0, lines: 0 });
  assert.deepEqual(U.textStats('hello big world\nnext'), { chars: 20, words: 4, lines: 2 });
  assert.equal(U.textStats('😀😀').chars, 2);
});

test('every tool has a unique id and a function; shortcuts do not clash', () => {
  assert.equal(new Set(U.TOOLS.map((t) => t.id)).size, U.TOOLS.length);
  assert.equal(new Set(U.TOOLS.map((t) => t.key + (t.shift ? '+' : ''))).size, U.TOOLS.length);
  for (const t of U.TOOLS) assert.equal(typeof t.fn('x y'), 'string');
});
