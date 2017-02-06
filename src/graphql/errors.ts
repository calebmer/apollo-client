/**
 * The type of a GraphQL error which may be returned by a GraphQL server. It
 * requires a message and contains some extra information that is helpful for
 * debugging.
 */
export interface GraphQLError {
  readonly message: string;
  readonly locations?: Array<{ line: number, column: number }>;
  readonly path?: Array<string | number>;
}
