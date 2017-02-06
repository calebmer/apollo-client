import { OperationDefinitionNode, FragmentDefinitionNode } from 'graphql';
import { Observable, Observer, Subscription } from '../util/Observable';
import { GraphQLObjectData, GraphQLData } from '../graphql/data';
import { GraphQLError } from '../graphql/errors';
import { ReduxGraphStore } from '../graph/store';

interface ExecutorFn {
  (options: {
    operation: OperationDefinitionNode,
    fragments?: { [fragmentName: string]: FragmentDefinitionNode },
    variables?: { [variableName: string]: GraphQLData },
  }): Observable<{
    data: GraphQLObjectData,
    errors: Array<GraphQLError>,
  }>;
}

/**
 * The state of an operation at any point in time. Contains perhaps the most
 * important piece of information, the data.
 */
export interface OperationState {
  /**
   * True while waiting for the executor function to emit its first result.
   * After the first result has been emit, loading will be set to false even if
   * the execution has not completed. See `executing` to know when an execution
   * has completely finished.
   */
  readonly loading: boolean;

  /**
   * Represents whether or not an execution is currently being run. This means
   * that an executor function was called and the observable returned by that
   * executor has not yet complete.
   *
   * If a subscription, or live query was executed then this may mean that this
   * property will be true even after data has been returned from the executor.
   */
  readonly executing: boolean;

  /**
   * The set of variables which corresponds to the data object in this state.
   * These variables may be changed at any time by the user.
   */
  readonly variables: Readonly<{ [variableName: string]: GraphQLData }>;

  /**
   * This property will be true if the state contains data that was returned
   * *directly* by the server. Whenever an operation result contains data that
   * was read even in part from the client then this flag will be set to false.
   *
   * So for example, if we are able to read data directly from the cache without
   * hitting the server then this value will be false. Once we do send a server
   * request and that request succesfully gives us data then we will emit a new
   * result and this property will be true. Finally, if some other operation
   * requests data that overlaps with the data returned by this operation we
   * will update the data for this operation and emit that, but set this flag to
   * false.
   */
  readonly canonical: boolean;

  /**
   * If we know that some of the data we provided in this state is innacurate
   * with the data that is on the server then we set this to true.
   *
   * This may happen, for example, when you make your first request
   * `{ person { id a b } }`, then `{ person { id b c } }`, and the `id` value
   * changes between the two requests. In this case the `a` field is missing in
   * the second request, so we can’t return you the data frmo the second request
   * because the `id` field is different. So instead we will give you the data
   * from the last request and set this property to true.
   */
  readonly stale: boolean;

  /**
   * An array of errors that were returned by the server. If no result has been
   * returned from the server then this will be an empty array.
   */
  readonly errors: Readonly<Array<GraphQLError>>;

  /**
   * The current GraphQL data for this operation.
   */
  readonly data?: Readonly<GraphQLObjectData>;
}

/**
 * A hot observable the tracks the lifecycle of a GraphQL operation. This
 * observable provides reactive data from the store in addition to allowing
 * users to trigger an execution at any point in time.
 *
 * An execution may be triggered with any set of variables. The data made
 * available by this operation will always correspond to the last set of
 * variables that a user provided. You can see what set of variables that is by
 * looking at the state with: `observable.getState().variables`.
 *
 * This integrated live view into the graph store can be very useful for UI
 * integration authors.
 */
export class ObservableOperation extends Observable<OperationState> {
  /**
   * The normalized graph representation of GraphQL data that we read from,
   * write to, and watch.
   */
  private readonly _graph: ReduxGraphStore;

  /**
   * The user defined execution function which runs a GraphQL query against the
   * user’s schema.
   */
  private readonly _executor: ExecutorFn;

  /**
   * The operation to be observed by this hot observable.
   */
  private readonly _operation: OperationDefinitionNode;

  /**
   * The fragments that are referenced by the operation we are observing.
   */
  private readonly _fragments: { [fragmentName: string]: FragmentDefinitionNode };

  /**
   * The root identifier to use when reading and writing from the store for our
   * operation. If null, then the store will never be watched.
   */
  private readonly _rootID: string | null;

  /**
   * **IMPORTANT**: These observers should not be used directly. Instead use the
   * private `_updateState` and `_error` methods when you want to emit an event.
   *
   * The observers who are currently watching this operation.
   */
  private readonly _observers: Array<Observer<OperationState>>;

  /**
   * A subscription for the observer that is currently watching the graph for
   * changes in the operation. If the graph is not being watched then this
   * property will be null.
   */
  private _watcher: Subscription | null;

  /**
   * The current execution being run for this operation. If there is no
   * execution currently occuring then this property will be null.
   */
  private _execution: Subscription | null;

  /**
   * The current state of the operation.
   */
  private _state: OperationState;

  constructor ({
    graph,
    executor,
    operation,
    fragments,
    initialVariables = {},
  }: {
    graph: ReduxGraphStore,
    executor: ExecutorFn,
    operation: OperationDefinitionNode,
    fragments?: { [fragmentName: string]: FragmentDefinitionNode },
    initialVariables?: { [variableName: string]: GraphQLData },
  }) {
    super(observer => this._onSubscribe(observer));

    this._graph = graph;
    this._executor = executor;
    this._execution = null;
    this._operation = operation;
    this._fragments = fragments;
    this._rootID = operation.operation === 'mutation' ? null : operation.operation;
    this._observers = [];

    this._state = {
      loading: false,
      executing: false,
      variables: initialVariables,
      canonical: false,
      stale: false,
      errors: [],
    };

    // As a side effect, start watching the graph.
    this._watch();
  }

  /**
   * Gets the current state of the observable operation synchronously. If no
   * full data has been found yet then the `data` property will be undefined.
   */
  public getState (): OperationState {
    return this._state;
  }

  /**
   * Executes an operation with an optional set of variables. If no variables
   * were provided the last set of variables will be used.
   *
   * Whenever new data is returned from the execution it will be written to the
   * graph so all operations watching the graph will get an update. If an error
   * is emit by the executor function then the operation will stop listening to
   * the store and will not write any data it got to the store.
   *
   * If the operation is currently executing, an error will be thrown. Make sure
   * that before calling this method any currently running executions are
   * stopped. To tell if the observable is currently executing run:
   * `observable.getState().executing`.
   */
  public execute (variables: { [variableName: string]: GraphQLData } = this._state.variables): void {
    // Throw an error when there is currently a running execution.
    if (this._execution !== null) {
      throw new Error('Cannot start a new execution when another execution is currently running.');
    }

    // Update the state so that we let our observers know that we are executing.
    this._updateState({
      loading: true,
      executing: true,
    });

    // Execute an operation and then subscribe to the results.
    this._execution = this._executor({
      operation: this._operation,
      fragments: this._fragments,
      variables,
    }).subscribe({
      next: result => {
        // Stop watching for state changes. If we have no errors in the result
        // then we will resume watching. If we have errors then we will not
        // resume watching until we get an execution result that does not have
        // errors.
        this._stopWatching();

        // If there were no errors in our execution then we want to write our
        // data to the store and then watch the store for new values.
        if (result.errors.length === 0) {
          // Write the data from our result to the graph.
          const { data } = this._graph.write({
            id: this._rootID,
            selectionSet: this._operation.selectionSet,
            data: result.data,
          });

          // Update the state with the data we just wrote to the store.
          this._updateState({
            loading: false,
            variables,
            canonical: true,
            stale: false,
            errors: result.errors,
            data,
          });

          // Start watching the graph again using the data we wrote as the
          // initial data.
          //
          // This method depends on the `_updateState` call above.
          this._watch();
        }
        // If there were errors then we do not want to write our data to the
        // store, but we still want to update our observable’s state.
        else {
          this._updateState({
            loading: false,
            variables,
            canonical: true,
            stale: false,
            errors: result.errors,
            data: result.data,
          });
        }
      },
      // When the executor emits an error then propogate that error to our
      // observers and do nothing else.
      error: error => {
        this._error(error);
      },
      // When the observable completes set both `loading` and `executing` to
      // false.
      complete: () => {
        this._updateState({
          loading: false,
          executing: false,
        });
      },
    });
  }

  /**
   * Stops any executions that are currently running by this observable. If
   * there are no executions running then calling this method is a noop.
   */
  public stopExecuting (): void {
    if (this._execution !== null) {
      this._execution.unsubscribe();
      this._execution = null;
      this._updateState({
        loading: false,
        executing: false,
      });
    }
  }

  /**
   * Might execute the operation using the user supplied execute function. When
   * called this method will first try to read the data for this operation from
   * the data graph. If that works then no execution is performed. However, if
   * the data could not be *completely* read from the graph an execution will be
   * performed using the user defined execute method.
   *
   * Takes an optional variables object. If no variables object was provided
   * then the last variables object will be used instead.
   */
  public maybeExecute (variables: { [variableName: string]: GraphQLData } = this._state.variables): void {
    // Throw an error when there is currently a running execution.
    if (this._execution !== null) {
      throw new Error('Cannot start a new execution when another execution is currently running.');
    }

    // If there is no root id then we must execute.
    if (this._rootID === null) {
      this.execute(variables);
      return;
    }

    try {
      // Try reading our operation from th store with the provided variables. If
      // it fails with a partial read error we will performan an execution.
      const result = this._graph.read({
        id: this._rootID,
        selectionSet: this._operation.selectionSet,
        fragments: this._fragments,
        variables,
        previousData: this._state.data,
      });

      // Update the state with the data we just read from the store.
      this._updateState({
        variables,
        canonical: false,
        stale: result.stale,
        data: result.data,
      });

      // Restart our graph watching so that the new variables will be used.
      this._stopWatching();
      this._watch();
    } catch (error) {
      // If this was not a partial read error then we need to throw.
      if (error._partialRead) {
        throw error;
      }

      // If it was a partial read error then we want to execute using the new
      // variables.
      this.execute(variables);
    }
  }

  /**
   * Updates the state of this observable using a partial state object. It will
   * then asynchronously emit the update to all of this observables observers.
   */
  private _updateState (partialState: Partial<OperationState>): void {
    const nextState = { ...this._state, ...partialState };
    this._state = nextState;
    this._observers.forEach(observer => setTimeout(() => {
      if (observer.next && this._state === nextState) {
        observer.next(nextState);
      }
    }, 0));
  }

  /**
   * Will start watching the data graph for updates to the operation’s
   * selection set.
   */
  private _watch (): void {
    // If the root id is null then nothing can be watched so calling this
    // function is a noop.
    if (this._rootID === null) {
      return;
    }

    // Throw an error if there is currently another watcher watching this query.
    if (this._watcher) {
      throw new Error('Cannot start watching the graph when the graph is currently being watched.');
    }

    // Get some properties from our state.
    const {
      variables,
      data: initialData,
    } = this._state;

    // Watch the graph and subscribe to it.
    this._watcher = this._graph.watch({
      id: this._rootID,
      selectionSet: this._operation.selectionSet,
      fragments: this._fragments,
      variables,
      initialData,
    }).subscribe({
      next: result => {
        // If the variables changed then we need to throw an error as we do not
        // expect that to happen!
        if (variables !== this._state.variables) {
          throw new Error('Operation variables changed without unsubscribing the graph watcher.');
        }

        // Skip the emit if it is for the initial data and the result is not
        // stale.
        if (result.data === initialData && result.stale === false) {
          return;
        }

        // Update the state with the new data from our graph watch.
        this._updateState({
          canonical: false,
          stale: result.stale,
          data: result.data,
        });
      },
      // If there was an error then propogate that error without doing anything
      // else.
      error: error => {
        this._error(error);
      },
    });
  }

  /**
   * Stops the observable from watching the data graph.
   */
  private _stopWatching (): void {
    if (this._watcher) {
      this._watcher.unsubscribe();
      this._watcher = null;
    }
  }

  /**
   * Subscribes an observer to this hot observable and returns an unsubscribe
   * function.
   *
   * We will also send the current state to the observable to get it started.
   */
  private _onSubscribe (observer: Observer<OperationState>): () => void {
    // Do an initial emit with the current state for the observer.
    setTimeout(() => observer.next && observer.next(this._state), 0);

    this._observers.push(observer);

    return () => {
      // Remove the observer from the observers array.
      const i = this._observers.indexOf(observer);
      if (i > -1) {
        this._observers.splice(i, 1);
      }
    };
  }

  /**
   * Emits an error to all of this observable’s observers.
   */
  private _error (error: Error): void {
    this._observers.forEach(observer => setTimeout(() => observer.error && observer.error(error), 0));
  }
}
