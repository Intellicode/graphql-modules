import { get, set } from 'lodash';
import { IResolvers } from 'graphql-tools';

export interface IResolversComposerMapping {
  [resolverPath: string]: any | any[];
}

function resolveRelevantMappings(resolvers: IResolvers, path: string, allMappings: IResolversComposerMapping): string[] {
  const result: string[] = [];
  const splitted = path.split('.');

  if (splitted.length === 2) {
    const typeName = splitted[0];
    const fieldName = splitted[1];

    if (fieldName === '*') {
      return Object.keys(resolvers[typeName])
        .map(field => `${typeName}.${field}`)
        .filter(mapItem => !allMappings[mapItem]);
    } else {
      return [path];
    }
  }

  return result;
}

export const asArray = <T>(fns: T | T[]) => (Array.isArray(fns) ? fns : [fns]);

export function chainFunctions(funcs: any[]) {
  if (funcs.length === 1) {
    return funcs[0];
  }

  return funcs.reduce((a, b) => (...args: any[]) => a(b(...args)));
}

/**
 * Wraps the resolvers object with the resolvers composition objects.
 * Implemented as a simple and basic middleware mechanism.
 *
 * @param resolvers - resolvers object
 * @param mapping - resolvers composition mapping
 * @hidden
 */
export function composeResolvers(resolvers: IResolvers, mapping: IResolversComposerMapping = {}): IResolvers {
  Object.keys(mapping).map((resolverPath: string) => {
    const composeFns = mapping[resolverPath];
    const relevantFields = resolveRelevantMappings(resolvers, resolverPath, mapping);

    relevantFields.forEach((path: string) => {
      const fns = chainFunctions([...asArray(composeFns), () => get(resolvers, path)]);
      set(resolvers, path, fns());
    });
  });

  return resolvers;
}
