import { assert } from 'chai';
import { Store, createStore } from 'redux';
import { parseOperationDefinition, parseSelectionSet } from './util/graphqlAST';
import { testObservable } from './util/testObservable';
import { deepFreeze } from '../src/util/maybeDeepFreeze';
import { Observable } from '../src/util/Observable';
import { ApolloAction } from '../src/actions';
import { GraphQLData, GraphQLObjectData } from '../src/graphql/data';
import { ReduxGraphStore, ReduxState } from '../src/graph/store';
import { ObservableOperation } from '../src/core/ObservableOperation';

const TEST_ID_KEY = Symbol('testIdKey');
const getDataID = (object: any) => object[TEST_ID_KEY];

/**
 * Creates an instance of `ReduxGraphStore` with a simple backing Redux store
 * instance.
 */
// TODO: Don’t use Redux graph store.
function createGraphStore (): ReduxGraphStore {
  let store: Store<ReduxState>;

  // Create the instance of our redux graph store using the actual Redux store
  // to provide the `dispatch` and `getState` functions.
  const graphStore: ReduxGraphStore = new ReduxGraphStore({
    reduxDispatch: action => store.dispatch(action),
    reduxGetState: () => store.getState(),
    getDataID,
  });

  // Create the redux store.
  store = createStore<ReduxState>(
    (state: ReduxState, action: ApolloAction): ReduxState => {
      // Redux our state using the reducer from the `graphStore` which we set
      // below. Deep freeze the result so that we can test that our Redux state
      // never gets mutated.
      return deepFreeze(graphStore.reduxReduce(state, action));
    },
    // Deep freeze the initial state.
    deepFreeze(ReduxGraphStore.initialState),
  );

  return graphStore;
}

describe.only('ObservableOperation', () => {
  it('will emit the default state and nothing else if execute was not called', done => {
    let noMore = false;
    const graph = createGraphStore();
    const observable = new ObservableOperation({
      graph,
      executor: () => {
        throw new Error('Unreachable.');
      },
      operation: parseOperationDefinition(`{ a b c }`),
    });
    observable.subscribe({
      next: result => {
        if (noMore) {
          done(new Error('Unreachable.'));
          return;
        }
        assert.deepEqual(result, {
          loading: false,
          executing: false,
          variables: {},
          canonical: false,
          stale: false,
          errors: [],
        });
        noMore = true;
        graph.write({
          id: 'query',
          selectionSet: parseSelectionSet(`{ a b c }`),
          data: { a: 1, b: 2, c: 3 },
        });
        setTimeout(() => {
          done();
        }, 10);
      },
      error: error => done(error),
    });
  });

  it('will execute a request using the executor and emit the result', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.next!({
              data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
              errors: [],
            });
            observer.complete!();
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            observable.execute({ x: 4, y: 5, z: 6 });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 4, y: 5, z: 6 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
              [{
                operation,
                fragments: {},
                variables: { x: 4, y: 5, z: 6 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will allow writes to the old result while executing', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.next!({
              data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
              errors: [],
            });
            observer.complete!();
          }, 10);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            observable.execute({ x: 4, y: 5, z: 6 });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet('{ a b }'),
              data: { a: 1.1, b: 2.1 },
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: { x: 1, y: 2, z: 3 },
              canonical: false,
              stale: false,
              errors: [],
              data: { a: 1.1, b: 2.1, c: 3 },
            });
            break;
          case 5:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 4, y: 5, z: 6 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
              [{
                operation,
                fragments: {},
                variables: { x: 4, y: 5, z: 6 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will skip the loading state for synchronous executors', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
            errors: [],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            observable.execute({ x: 4, y: 5, z: 6 });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 4, y: 5, z: 6 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
              [{
                operation,
                fragments: {},
                variables: { x: 4, y: 5, z: 6 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will watch the graph for updates after execution', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
            errors: [],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet(`{ a b c }`),
              data: { a: 0.5, b: 1.5, c: 2.5 },
            });
            setTimeout(() => {
              observable.execute({ x: 1, y: 2, z: 3 });
            }, 5);
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet(`{ b }`),
              data: { b: 2.5 },
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: false,
              stale: false,
              errors: [],
              data: { a: 1, b: 2.5, c: 3 },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet(`{ a c }`),
              data: { a: 1.5, c: 3.5 },
            });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: false,
              stale: false,
              errors: [],
              data: { a: 1.5, b: 2.5, c: 3.5 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will not watch the graph for updates if there were errors', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
            errors: [{ message: 'Yikes!' }],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet(`{ a b c }`),
              data: { a: 0.5, b: 1.5, c: 2.5 },
            });
            setTimeout(() => {
              observable.execute({ x: 1, y: 2, z: 3 });
            }, 5);
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [{ message: 'Yikes!' }],
              data: { a: 1, b: 2, c: 3 },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet(`{ b }`),
              data: { b: 2.5 },
            });
            setTimeout(() => {
              done();
            }, 10);
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will change the variables being watched when executing', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ field(arg: $arg) }`);
    const selectionSet = parseSelectionSet(`{ field(arg: $arg) }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        const result = {
          data: { field: args[0].variables.arg },
          errors: [],
        };
        return new Observable(observer => {
          observer.next!(result);
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ arg: 1 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { arg: 1 },
              canonical: true,
              stale: false,
              errors: [],
              data: { field: 1 },
            });
            graph.write({
              id: 'query',
              selectionSet,
              variables: { arg: 1 },
              data: { field: 1.1 },
            });
            graph.write({
              id: 'query',
              selectionSet,
              variables: { arg: 2 },
              data: { field: 1.2 },
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { arg: 1 },
              canonical: false,
              stale: false,
              errors: [],
              data: { field: 1.1 },
            });
            observable.execute({ arg: 2 });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { arg: 2 },
              canonical: true,
              stale: false,
              errors: [],
              data: { field: 2 },
            });
            graph.write({
              id: 'query',
              selectionSet,
              variables: { arg: 1 },
              data: { field: 2.1 },
            });
            graph.write({
              id: 'query',
              selectionSet,
              variables: { arg: 2 },
              data: { field: 2.2 },
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { arg: 2 },
              canonical: false,
              stale: false,
              errors: [],
              data: { field: 2.2 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { arg: 1 },
              }],
              [{
                operation,
                fragments: {},
                variables: { arg: 2 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will mark output data as stale when an id to a path changes', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ foo { a b c } }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        const result = {
          data: {
            foo: {
              [TEST_ID_KEY]: String((executions.length * 4) - 3),
              a: (executions.length * 4) - 2,
              b: (executions.length * 4) - 1,
              c: (executions.length * 4) - 0,
            },
          },
          errors: [],
        };
        return new Observable(observer => {
          observer.next!(result);
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { foo: { a: 2, b: 3, c: 4 } },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet('{ foo { a b } }'),
              data: {
                foo: {
                  [TEST_ID_KEY]: 'not 1',
                  a: 2.1,
                  b: 3.1,
                },
              },
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: true,
              errors: [],
              data: { foo: { a: 2, b: 3, c: 4 } },
            });
            graph.write({
              id: '(1)',
              selectionSet: parseSelectionSet('{ c }'),
              data: { c: 4.1 },
            });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: true,
              errors: [],
              data: { foo: { a: 2, b: 3, c: 4.1 } },
            });
            observable.execute();
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { foo: { a: 6, b: 7, c: 8 } },
            });
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will support multiple emits from the executed observable', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        const result1 = {
          data: {
            a: (executions.length * 9) - 8,
            b: (executions.length * 9) - 7,
            c: (executions.length * 9) - 6,
          },
          errors: [],
        };
        const result2 = {
          data: {
            a: (executions.length * 9) - 5,
            b: (executions.length * 9) - 4,
            c: (executions.length * 9) - 3,
          },
          errors: [],
        };
        const result3 = {
          data: {
            a: (executions.length * 9) - 2,
            b: (executions.length * 9) - 1,
            c: (executions.length * 9) - 0,
          },
          errors: [],
        };
        return new Observable(observer => {
          setTimeout(() => {
            observer.next!(result1);
            setTimeout(() => {
              observer.next!(result2);
              setTimeout(() => {
                observer.next!(result3);
              }, 5);
            }, 5);
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 7, b: 8, c: 9 },
            });
            observable.stopExecuting();
            break;
          case 5:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 7, b: 8, c: 9 },
            });
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will support multiple emits with an early stop from the executed observable', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        const result1 = {
          data: {
            a: (executions.length * 9) - 8,
            b: (executions.length * 9) - 7,
            c: (executions.length * 9) - 6,
          },
          errors: [],
        };
        const result2 = {
          data: {
            a: (executions.length * 9) - 5,
            b: (executions.length * 9) - 4,
            c: (executions.length * 9) - 3,
          },
          errors: [],
        };
        const result3 = {
          data: {
            a: (executions.length * 9) - 2,
            b: (executions.length * 9) - 1,
            c: (executions.length * 9) - 0,
          },
          errors: [],
        };
        return new Observable(observer => {
          let closed = false;
          observer.next!(result1);
          setTimeout(() => {
            if (!closed) {
              observer.next!(result2);
              setTimeout(() => {
                if (!closed) {
                  observer.next!(result3);
                }
              }, 5);
            }
          }, 5);
          return () => {
            closed = true;
          };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            observable.stopExecuting();
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will allow graph updates in between execution updates', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        const result1 = {
          data: {
            a: (executions.length * 9) - 8,
            b: (executions.length * 9) - 7,
            c: (executions.length * 9) - 6,
          },
          errors: [],
        };
        const result2 = {
          data: {
            a: (executions.length * 9) - 5,
            b: (executions.length * 9) - 4,
            c: (executions.length * 9) - 3,
          },
          errors: [],
        };
        const result3 = {
          data: {
            a: (executions.length * 9) - 2,
            b: (executions.length * 9) - 1,
            c: (executions.length * 9) - 0,
          },
          errors: [],
        };
        return new Observable(observer => {
          observer.next!(result1);
          setTimeout(() => {
            observer.next!(result2);
            setTimeout(() => {
              observer.next!(result3);
            }, 10);
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            graph.write({
              id: 'query',
              selectionSet: parseSelectionSet('{ a b }'),
              data: { a: 4.1, b: 5.1 },
            });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
              data: { a: 4.1, b: 5.1, c: 6 },
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 7, b: 8, c: 9 },
            });
            observable.stopExecuting();
            break;
          case 5:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 7, b: 8, c: 9 },
            });
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will allow no execution emits', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.complete!();
          }, 10);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 3:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 4:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will throw an error if execute is called when it is currently executing', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(() => {
          return () => { /* noop */ };
        });
      },
      operation,
    });
    observable.execute();
    assert.throws(() => {
      observable.execute();
    }, 'Cannot start a new execution when another execution is currently running.');
    assert.throws(() => {
      observable.execute({ a: 1, b: 2, c: 3 });
    }, 'Cannot start a new execution when another execution is currently running.');
    setTimeout(() => {
      assert.throws(() => {
        observable.execute();
      }, 'Cannot start a new execution when another execution is currently running.');
      assert.throws(() => {
        observable.execute({ a: 1, b: 2, c: 3 });
      }, 'Cannot start a new execution when another execution is currently running.');
      assert.deepEqual(executions, [
        [{
          operation,
          fragments: {},
          variables: {},
        }],
      ]);
      done();
    }, 10);
  });

  it('will allow new executions when the execution has finished', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.complete!();
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    observable.execute();
    assert.throws(() => {
      observable.execute();
    }, 'Cannot start a new execution when another execution is currently running.');
    assert.throws(() => {
      observable.execute({ a: 1, b: 2, c: 3 });
    }, 'Cannot start a new execution when another execution is currently running.');
    setTimeout(() => {
      observable.execute({ a: 1, b: 2, c: 3 });
      assert.throws(() => {
        observable.execute();
      }, 'Cannot start a new execution when another execution is currently running.');
      assert.throws(() => {
        observable.execute({ a: 1, b: 2, c: 3 });
      }, 'Cannot start a new execution when another execution is currently running.');
      assert.deepEqual(executions, [
        [{
          operation,
          fragments: {},
          variables: {},
        }],
        [{
          operation,
          fragments: {},
          variables: { a: 1, b: 2, c: 3 },
        }],
      ]);
      done();
    }, 10);
  });

  it('will execute a request even if there are no observable subscribers', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.next!({
              data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
              errors: [],
            });
            observer.complete!();
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    assert.deepEqual(observable.getState(), {
      loading: false,
      executing: false,
      variables: {},
      canonical: false,
      stale: false,
      errors: [],
    });
    observable.execute({ x: 1, y: 2, z: 3 });
    assert.deepEqual(observable.getState(), {
      loading: true,
      executing: true,
      variables: {},
      canonical: false,
      stale: false,
      errors: [],
    });
    setTimeout(() => {
      assert.deepEqual(observable.getState(), {
        loading: false,
        executing: false,
        variables: { x: 1, y: 2, z: 3 },
        canonical: true,
        stale: false,
        errors: [],
        data: { a: 1, b: 2, c: 3 },
      });
      observable.execute({ x: 4, y: 5, z: 6 });
      assert.deepEqual(observable.getState(), {
        loading: true,
        executing: true,
        variables: { x: 1, y: 2, z: 3 },
        canonical: true,
        stale: false,
        errors: [],
        data: { a: 1, b: 2, c: 3 },
      });
      setTimeout(() => {
        assert.deepEqual(observable.getState(), {
          loading: false,
          executing: false,
          variables: { x: 4, y: 5, z: 6 },
          canonical: true,
          stale: false,
          errors: [],
          data: { a: 4, b: 5, c: 6 },
        });
        done();
      }, 10);
    }, 10);
  });

  it('will update if variables change but data does not', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: { a: 1, b: 2, c: 3 },
            errors: [],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            observable.execute({ x: 4, y: 5, z: 6 });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 4, y: 5, z: 6 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
              [{
                operation,
                fragments: {},
                variables: { x: 4, y: 5, z: 6 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('rerun even if variables do not change', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
            errors: [],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            observable.execute({ x: 1, y: 2, z: 3 });
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: { x: 1, y: 2, z: 3 },
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 4, b: 5, c: 6 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
              [{
                operation,
                fragments: {},
                variables: { x: 1, y: 2, z: 3 },
              }],
            ]);
            done();
            break;
          default:
            done(new Error('`next` called too many times.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will propogate an error', done => {
    const error1 = new Error('error 1');
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          setTimeout(() => {
            observer.error!(error1);
            observer.complete!();
          }, 10);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 3:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            done();
            break;
          default:
            done(new Error('Unexepcted `next` call.'));
        }
      },
      error: error => {
        switch (counter++) {
          case 2:
            assert.strictEqual(error, error1);
            break;
          default:
            done(new Error('Unexepcted `error` call.'));
        }
      },
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will propogate a synchronous error', done => {
    const error1 = new Error('error 1');
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.error!(error1);
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            done();
            break;
          default:
            done(new Error('Unexepcted `next` call.'));
        }
      },
      error: error => {
        switch (counter++) {
          case 1:
            assert.strictEqual(error, error1);
            break;
          default:
            done(new Error('Unexepcted `error` call.'));
        }
      },
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will propogate multiple errors from the executor', done => {
    const error1 = new Error('error 1');
    const error2 = new Error('error 2');
    const error3 = new Error('error 3');
    const error4 = new Error('error 4');
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ a b c }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.error!(error1);
          setTimeout(() => {
            observer.error!(error2);
            setTimeout(() => {
              observer.error!(error3);
              setTimeout(() => {
                observer.next!({
                  data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
                  errors: [],
                });
                setTimeout(() => {
                  observer.error!(error4);
                  observer.complete!();
                }, 5);
              }, 5);
            }, 5);
          }, 5);
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: true,
              executing: true,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            break;
          case 5:
            assert.deepEqual(result, {
              loading: false,
              executing: true,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            break;
          case 7:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { a: 1, b: 2, c: 3 },
            });
            done();
            break;
          default:
            done(new Error('Unexepcted `next` call.'));
        }
      },
      error: error => {
        switch (counter++) {
          case 2:
            assert.strictEqual(error, error1);
            break;
          case 3:
            assert.strictEqual(error, error2);
            break;
          case 4:
            assert.strictEqual(error, error3);
            break;
          case 6:
            assert.strictEqual(error, error4);
            break;
          default:
            done(new Error('Unexepcted `error` call.'));
        }
      },
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will write execution results to the store', done => {
    const executions: Array<Array<any>> = [];
    const graph = createGraphStore();
    const operation = parseOperationDefinition(`{ foo { bar { a b c } } }`);
    const observable = new ObservableOperation({
      graph,
      executor: (...args: Array<any>) => {
        executions.push(args);
        return new Observable(observer => {
          observer.next!({
            data: {
              foo: {
                [TEST_ID_KEY]: String((executions.length * 4) - 3),
                bar: {
                  a: (executions.length * 4) - 2,
                  b: (executions.length * 4) - 1,
                  c: (executions.length * 4) - 0,
                },
              },
            },
            errors: [],
          });
          observer.complete!();
          return () => { /* noop */ };
        });
      },
      operation,
    });
    let counter = 0;
    observable.subscribe({
      next: result => {
        switch (counter++) {
          case 0:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: false,
              stale: false,
              errors: [],
            });
            try {
              graph.read({
                id: 'query',
                selectionSet: parseSelectionSet(`{ foo { bar { a b c } } }`),
              });
              throw new Error('Unreachable.');
            } catch (error) {
              assert.equal(error.message, 'No graph reference found for field \'foo\'.');
              assert.isTrue(error._partialRead);
            }
            try {
              graph.read({
                id: '(1)',
                selectionSet: parseSelectionSet(`{ bar { a b c } }`),
              });
              throw new Error('Unreachable.');
            } catch (error) {
              assert.equal(error.message, 'No graph reference found for field \'bar\'.');
              assert.isTrue(error._partialRead);
            }
            try {
              graph.read({
                id: '(1).bar',
                selectionSet: parseSelectionSet(`{ a b c }`),
              });
              throw new Error('Unreachable.');
            } catch (error) {
              assert.equal(error.message, 'No scalar value found for field \'a\'.');
              assert.isTrue(error._partialRead);
            }
            observable.execute();
            break;
          case 1:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { foo: { bar: { a: 2, b: 3, c: 4 } } },
            });
            assert.deepEqual(graph.read({
              id: 'query',
              selectionSet: parseSelectionSet(`{ foo { bar { a b c } } }`),
            }), {
              stale: false,
              data: { foo: { bar: { a: 2, b: 3, c: 4 } } },
            });
            assert.deepEqual(graph.read({
              id: '(1)',
              selectionSet: parseSelectionSet(`{ bar { a b c } }`),
            }), {
              stale: false,
              data: { bar: { a: 2, b: 3, c: 4 } },
            });
            assert.deepEqual(graph.read({
              id: '(1).bar',
              selectionSet: parseSelectionSet(`{ a b c }`),
            }), {
              stale: false,
              data: { a: 2, b: 3, c: 4 },
            });
            observable.execute();
            break;
          case 2:
            assert.deepEqual(result, {
              loading: false,
              executing: false,
              variables: {},
              canonical: true,
              stale: false,
              errors: [],
              data: { foo: { bar: { a: 6, b: 7, c: 8 } } },
            });
            assert.deepEqual(graph.read({
              id: 'query',
              selectionSet: parseSelectionSet(`{ foo { bar { a b c } } }`),
            }), {
              stale: false,
              data: { foo: { bar: { a: 6, b: 7, c: 8 } } },
            });
            assert.deepEqual(graph.read({
              id: '(1)',
              selectionSet: parseSelectionSet(`{ bar { a b c } }`),
            }), {
              stale: false,
              data: { bar: { a: 2, b: 3, c: 4 } },
            });
            assert.deepEqual(graph.read({
              id: '(1).bar',
              selectionSet: parseSelectionSet(`{ a b c }`),
            }), {
              stale: false,
              data: { a: 2, b: 3, c: 4 },
            });
            assert.deepEqual(graph.read({
              id: '(5)',
              selectionSet: parseSelectionSet(`{ bar { a b c } }`),
            }), {
              stale: false,
              data: { bar: { a: 6, b: 7, c: 8 } },
            });
            assert.deepEqual(graph.read({
              id: '(5).bar',
              selectionSet: parseSelectionSet(`{ a b c }`),
            }), {
              stale: false,
              data: { a: 6, b: 7, c: 8 },
            });
            assert.deepEqual(executions, [
              [{
                operation,
                fragments: {},
                variables: {},
              }],
              [{
                operation,
                fragments: {},
                variables: {},
              }],
            ]);
            assert.deepEqual((graph as any)._reduxGetState().graphData, {
              'query': {
                scalars: {},
                references: { foo: '(5)' },
              },
              '(1)': {
                scalars: {},
                references: { bar: '(1).bar' },
              },
              '(1).bar': {
                scalars: { a: 2, b: 3, c: 4 },
                references: {},
              },
              '(5)': {
                scalars: {},
                references: { bar: '(5).bar' },
              },
              '(5).bar': {
                scalars: { a: 6, b: 7, c: 8 },
                references: {},
              },
            });
            done();
            break;
          default:
            done(new Error('Unexpected `next` call.'));
        }
      },
      error: error => done(error),
      complete: () => done(new Error('Unreachable.')),
    });
  });

  it('will error when trying to use a mutation', () => {
    try {
      new ObservableOperation({
        graph: createGraphStore(),
        executor: (...args: Array<any>) => null as any,
        operation: parseOperationDefinition(`mutation { a b c }`),
      });
      throw new Error('Unreachable.');
    } catch (error) {
      assert.equal(error.message, 'Mutations may not be observed.');
    }
  });

  describe('getState', () => {
    it('will return the current state', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition(`{ a b c }`);
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            setTimeout(() => {
              observer.next!({
                data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
                errors: [],
              });
              observer.complete!();
            }, 5);
            return () => { /* noop */ };
          });
        },
        operation,
      });
      let counter = 0;
      observable.subscribe({
        next: () => {
          switch (counter++) {
            case 0:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.execute({ x: 1, y: 2, z: 3 });
              break;
            case 1:
              assert.deepEqual(observable.getState(), {
                loading: true,
                executing: true,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              break;
            case 2:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.execute({ x: 4, y: 5, z: 6 });
              break;
            case 3:
              assert.deepEqual(observable.getState(), {
                loading: true,
                executing: true,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              break;
            case 4:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: { x: 4, y: 5, z: 6 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 4, b: 5, c: 6 },
              });
              assert.deepEqual(executions, [
                [{
                  operation,
                  fragments: {},
                  variables: { x: 1, y: 2, z: 3 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { x: 4, y: 5, z: 6 },
                }],
              ]);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });

    it('will return the current state with errors', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition(`{ a b c }`);
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            setTimeout(() => {
              observer.next!({
                data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
                errors: [{ message: 'Yikes!' }],
              });
              observer.complete!();
            }, 5);
            return () => { /* noop */ };
          });
        },
        operation,
      });
      let counter = 0;
      observable.subscribe({
        next: () => {
          switch (counter++) {
            case 0:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.execute({ x: 1, y: 2, z: 3 });
              break;
            case 1:
              assert.deepEqual(observable.getState(), {
                loading: true,
                executing: true,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              break;
            case 2:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [{ message: 'Yikes!' }],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.execute({ x: 4, y: 5, z: 6 });
              break;
            case 3:
              assert.deepEqual(observable.getState(), {
                loading: true,
                executing: true,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [{ message: 'Yikes!' }],
                data: { a: 1, b: 2, c: 3 },
              });
              break;
            case 4:
              assert.deepEqual(observable.getState(), {
                loading: false,
                executing: false,
                variables: { x: 4, y: 5, z: 6 },
                canonical: true,
                stale: false,
                errors: [{ message: 'Yikes!' }],
                data: { a: 4, b: 5, c: 6 },
              });
              assert.deepEqual(executions, [
                [{
                  operation,
                  fragments: {},
                  variables: { x: 1, y: 2, z: 3 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { x: 4, y: 5, z: 6 },
                }],
              ]);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });
  });

  describe('stopExecuting', () => {
    it('will stop an execution', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition(`{ a b c }`);
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            let closed = false;
            setTimeout(() => {
              if (closed) {
                return;
              }
              observer.next!({
                data: { a: (executions.length * 3) - 2, b: (executions.length * 3) - 1, c: (executions.length * 3) - 0 },
                errors: [],
              });
              observer.complete!();
            }, 10);
            return () => {
              closed = true;
            };
          });
        },
        operation,
      });
      let counter = 0;
      observable.subscribe({
        next: result => {
          switch (counter++) {
            case 0:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.execute({ x: 1, y: 2, z: 3 });
              break;
            case 1:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              break;
            case 2:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.execute({ x: 4, y: 5, z: 6 });
              break;
            case 3:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.stopExecuting();
              break;
            case 4:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              assert.deepEqual(executions, [
                [{
                  operation,
                  fragments: {},
                  variables: { x: 1, y: 2, z: 3 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { x: 4, y: 5, z: 6 },
                }],
              ]);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });
  });

  describe('maybeExecute', () => {
    it('will only execute a request when there is no data in the store', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition(`{ a b c }`);
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            setTimeout(() => {
              observer.next!({
                data: {
                  a: (executions.length * 3) - 2,
                  b: (executions.length * 3) - 1,
                  c: (executions.length * 3) - 0,
                },
                errors: [],
              });
              observer.complete!();
            }, 10);
            return () => { /* noop */ };
          });
        },
        operation,
      });
      let counter = 0;
      observable.subscribe({
        next: result => {
          switch (counter++) {
            case 0:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.maybeExecute({ x: 1, y: 2, z: 3 });
              break;
            case 1:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              break;
            case 2:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { x: 1, y: 2, z: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.maybeExecute({ x: 4, y: 5, z: 6 });
              break;
            case 3:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { x: 4, y: 5, z: 6 },
                canonical: false,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              observable.execute({ x: 7, y: 8, z: 9 });
              break;
            case 4:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: { x: 4, y: 5, z: 6 },
                canonical: false,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              break;
            case 5:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { x: 7, y: 8, z: 9 },
                canonical: true,
                stale: false,
                errors: [],
                data: { a: 4, b: 5, c: 6 },
              });
              assert.deepEqual(executions, [
                [{
                  operation,
                  fragments: {},
                  variables: { x: 1, y: 2, z: 3 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { x: 7, y: 8, z: 9 },
                }],
              ]);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });

    it('won’t execute operations with variables that have already been written', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition(`{ field(arg: $arg) }`);
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            setTimeout(() => {
              observer.next!({
                data: { field: args[0].variables.arg },
                errors: [],
              });
              observer.complete!();
            }, 10);
            return () => { /* noop */ };
          });
        },
        operation,
      });
      let counter = 0;
      observable.subscribe({
        next: result => {
          switch (counter++) {
            case 0:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.maybeExecute({ arg: 1 });
              break;
            case 1:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              break;
            case 2:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 1 },
                canonical: true,
                stale: false,
                errors: [],
                data: { field: 1 },
              });
              observable.maybeExecute({ arg: 2 });
              break;
            case 3:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: { arg: 1 },
                canonical: true,
                stale: false,
                errors: [],
                data: { field: 1 },
              });
              break;
            case 4:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 2 },
                canonical: true,
                stale: false,
                errors: [],
                data: { field: 2 },
              });
              observable.maybeExecute({ arg: 1 });
              break;
            case 5:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 1 },
                canonical: false,
                stale: false,
                errors: [],
                data: { field: 1 },
              });
              observable.maybeExecute({ arg: 3 });
              break;
            case 6:
              assert.deepEqual(result, {
                loading: true,
                executing: true,
                variables: { arg: 1 },
                canonical: false,
                stale: false,
                errors: [],
                data: { field: 1 },
              });
              break;
            case 7:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 3 },
                canonical: true,
                stale: false,
                errors: [],
                data: { field: 3 },
              });
              observable.maybeExecute({ arg: 1 });
              break;
            case 8:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 1 },
                canonical: false,
                stale: false,
                errors: [],
                data: { field: 1 },
              });
              observable.maybeExecute({ arg: 2 });
              break;
            case 9:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 2 },
                canonical: false,
                stale: false,
                errors: [],
                data: { field: 2 },
              });
              observable.maybeExecute({ arg: 3 });
              break;
            case 10:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: { arg: 3 },
                canonical: false,
                stale: false,
                errors: [],
                data: { field: 3 },
              });
              assert.deepEqual(executions, [
                [{
                  operation,
                  fragments: {},
                  variables: { arg: 1 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { arg: 2 },
                }],
                [{
                  operation,
                  fragments: {},
                  variables: { arg: 3 },
                }],
              ]);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });

    it('won’t execute if data is already in the graph', done => {
      const executions: Array<Array<any>> = [];
      const graph = createGraphStore();
      const operation = parseOperationDefinition('{ a b c }');
      const observable = new ObservableOperation({
        graph,
        executor: (...args: Array<any>) => {
          executions.push(args);
          return new Observable(observer => {
            observer.error!(new Error('Unreachable.'));
            observer.complete!();
            return () => { /* noop */ };
          });
        },
        operation,
      });
      graph.write({
        id: 'query',
        selectionSet: parseSelectionSet('{ a b c }'),
        data: { a: 1, b: 2, c: 3 },
      });
      let counter = 0;
      observable.subscribe({
        next: result => {
          switch (counter++) {
            case 0:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
              });
              observable.maybeExecute();
              break;
            case 1:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
                data: { a: 1, b: 2, c: 3 },
              });
              graph.write({
                id: 'query',
                selectionSet: parseSelectionSet('{ b c }'),
                data: { b: 2.1, c: 3.1 },
              });
              break;
            case 2:
              assert.deepEqual(result, {
                loading: false,
                executing: false,
                variables: {},
                canonical: false,
                stale: false,
                errors: [],
                data: { a: 1, b: 2.1, c: 3.1 },
              });
              assert.deepEqual(executions, []);
              done();
              break;
            default:
              done(new Error('`next` called too many times.'));
          }
        },
        error: error => done(error),
        complete: () => done(new Error('Unreachable.')),
      });
    });
  });
});
