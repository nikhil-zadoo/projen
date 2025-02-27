import { JsonFile } from '../src/json';
import { decamelizeKeysRecursively, dedupArray, deepMerge, isTruthy, getFilePermissions, formatAsPythonModule } from '../src/util';
import { TestProject } from '../src/util/synth';

describe('decamelizeRecursively', () => {
  test('decamel recurses an object structure', () => {
    // GIVEN
    const input = {
      dependsOn: ['a', 'b', 'c'],
      volumes: [
        {
          driver: 'tmpfs',
          driverOpts: {
            type: 'nfs',
            o: 'addr=...',
            device: ':/docker/example',
          },
        },
      ],
    };

    // WHEN
    const output = decamelizeKeysRecursively(input);

    // THEN
    expect(output).toEqual({
      depends_on: ['a', 'b', 'c'],
      volumes: [
        {
          driver: 'tmpfs',
          driver_opts: {
            type: 'nfs',
            o: 'addr=...',
            device: ':/docker/example',
          },
        },
      ],
    });
  });

  test('decamel quits when it recurses too deeply', () => {
    // GIVEN
    const circle: Record<string, any> = {};
    circle.circle = circle;

    // WHEN
    expect(() => decamelizeKeysRecursively(circle)).toThrow(/circular reference/);
  });

  test('decamel can know when not to decamelize a key', () => {
    // GIVEN
    const input = {
      dependsOn: ['a', 'b'],
      environment: {
        leaveThisAlone: true,
        LEAVE_CASE_ALONE: true,
      },
    };

    // WHEN
    const output = decamelizeKeysRecursively(input, {
      shouldDecamelize(path, _value) {
        return !/^environment\./.test(path.join('.'));
      },
    });

    // THEN
    expect(output).toEqual({
      depends_on: ['a', 'b'],
      environment: {
        leaveThisAlone: true,
        LEAVE_CASE_ALONE: true,
      },
    });
  });
});

test('isTruthy', () => {
  expect(isTruthy(undefined)).toEqual(false);
  expect(isTruthy('false')).toEqual(false);
  expect(isTruthy('0')).toEqual(false);
  expect(isTruthy('null')).toEqual(false);
  expect(isTruthy('')).toEqual(false);
  expect(isTruthy('true')).toEqual(true);
  expect(isTruthy('1')).toEqual(true);
  expect(isTruthy('enabled')).toEqual(true);
});

describe('deepMerge (destructive: false)', () => {
  test('merges objects', () => {
    // GIVEN
    const original = { a: { b: 3 } };

    // WHEN
    deepMerge([original, { a: { c: 4 } }]);

    // THEN
    expect(original).toEqual({ a: { b: 3, c: 4 } });
  });

  test('overwrites non-objects', () => {
    // GIVEN
    const original = { a: 'foo' };

    // WHEN
    deepMerge([original, { a: { b: 3 } }]);

    // THEN
    expect(original).toEqual({ a: { b: 3 } });
  });

  test('does not overwrite if rightmost is "undefined"', () => {
    // GIVEN
    const original = { a: 1 };

    // WHEN
    deepMerge([original, { a: undefined }]);

    // THEN
    expect(original).toEqual({ a: 1 });
  });

  test('does not recurse on projects', () => {
    // GIVEN
    const proj1 = new TestProject();
    const proj2 = new TestProject();
    const objA = { a: proj1 };
    const objB = { a: proj2 };

    // WHEN
    deepMerge([objA, objB]);

    // THEN
    expect(objA).toEqual(objB);
  });

  test('does not recurse on components', () => {
    // GIVEN
    const proj = new TestProject();
    const comp1 = new JsonFile(proj, 'foo', { obj: 3 });
    const comp2 = new JsonFile(proj, 'bar', { obj: 5 });
    const objA = { a: comp1 };
    const objB = { a: comp2 };

    // WHEN
    deepMerge([objA, objB]);

    // THEN
    expect(objA).toEqual(objB);
  });
});

describe('deepMerge (destructive: true)', () => {
  test('merges objects', () => {
    // GIVEN
    const original = { a: { b: 3 } };

    // WHEN
    deepMerge([original, { a: { c: 4 } }], true);

    // THEN
    expect(original).toEqual({ a: { b: 3, c: 4 } });
  });

  test('overwrites non-objects', () => {
    // GIVEN
    const original = { a: 'foo' };

    // WHEN
    deepMerge([original, { a: { b: 3 } }], true);

    // THEN
    expect(original).toEqual({ a: { b: 3 } });
  });

  test('does overwrite if rightmost is "undefined"', () => {
    // GIVEN
    const original = { a: 1 };

    // WHEN
    deepMerge([original, { a: undefined }], true);

    // THEN
    expect(original).toEqual({}); // ! different from the non-destructive case
  });

  test('does not recurse on projects', () => {
    // GIVEN
    const proj1 = new TestProject();
    const proj2 = new TestProject();
    const objA = { a: proj1 };
    const objB = { a: proj2 };

    // WHEN
    deepMerge([objA, objB], true);

    // THEN
    expect(objA).toEqual(objB);
  });

  test('does not recurse on components', () => {
    // GIVEN
    const proj = new TestProject();
    const comp1 = new JsonFile(proj, 'foo', { obj: 3 });
    const comp2 = new JsonFile(proj, 'bar', { obj: 5 });
    const objA = { a: comp1 };
    const objB = { a: comp2 };

    // WHEN
    deepMerge([objA, objB], true);

    // THEN
    expect(objA).toEqual(objB);
  });
});

test('dedupArray', () => {
  expect(dedupArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  expect(dedupArray(['a', 'a', 'b', 'a'])).toEqual(['a', 'b']);
});

test('getFilePermissions', () => {
  expect(getFilePermissions({})).toEqual('644');
  expect(getFilePermissions({ readonly: true, executable: true })).toEqual('500');
  expect(getFilePermissions({ readonly: true, executable: false })).toEqual('400');
  expect(getFilePermissions({ readonly: false, executable: true })).toEqual('755');
  expect(getFilePermissions({ readonly: false, executable: false })).toEqual('644');
  expect(getFilePermissions({ readonly: false })).toEqual('644');
  expect(getFilePermissions({ executable: true })).toEqual('755');
});

test('formatAsPythonModule', () => {
  expect(formatAsPythonModule('foo-bar-baz')).toEqual('foo_bar_baz');
  expect(formatAsPythonModule('foo.bar.baz')).toEqual('foo_bar_baz');
});
