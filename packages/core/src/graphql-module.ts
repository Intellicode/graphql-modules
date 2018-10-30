import { IResolvers, makeExecutableSchema } from 'graphql-tools';
import { mergeGraphQLSchemas, mergeResolvers } from '@graphql-modules/epoxy';
import { Provider, AppContext, Injector as SimpleInjector } from './di/types';
import { DocumentNode, print } from 'graphql';
import { IResolversComposerMapping } from './resolvers-composition';
import { Injector } from './di';

/**
 * A context builder method signature for `contextBuilder`.
 */
export type BuildContextFn<Request, Context> = (
  networkRequest: Request,
  currentContext: AppContext<Context>,
  injector: SimpleInjector,
) => Promise<Context>;

/**
 * Defined the structure of GraphQL module options object.
 */
export interface GraphQLModuleOptions<Config, Request, Context> {
  /**
   * The name of the module. Use it later to get your `ModuleConfig(name)` or to declare
   * a dependency to this module (in another module)
   */
  name: string;
  /**
   * A definition of GraphQL type definitions, as string or `DocumentNode`.
   * Arrays are also accepted, and they will get merged.
   * You can also pass a function that will get the module's config as argument, and should return
   * the type definitions.
   */
  typeDefs?: string | string[] | DocumentNode | DocumentNode[] | ((config: Config) => string | string[] | DocumentNode | DocumentNode[]);
  /**
   * Resolvers object, or a function will get the module's config as argument, and should
   * return the resolvers object.
   */
  resolvers?: IResolvers | ((config: Config) => IResolvers);
  /**
   * Context builder method. Use this to add your own fields and data to the GraphQL `context`
   * of each execution of GraphQL.
   */
  contextBuilder?: BuildContextFn<Request, Context>;
  /**
   * The dependencies that this module need to run correctly, you can either provide the `GraphQLModule`,
   * or provide a string with the name of the other module.
   * Adding a dependency will effect the order of the type definition building, resolvers building and context
   * building.
   */
  imports?: ((config: Config) => Array<GraphQLModule<any, Request, any>>) | Array<GraphQLModule<any, Request, any>>;
  /**
   * A list of `Providers` to load into the GraphQL module.
   * It could be either a `class` or a value/class instance.
   * All loaded class will be loaded as Singletons, and the instance will be
   * shared across all GraphQL executions.
   */
  providers?: Provider[] | ((config: Config) => Provider[]);
  /** Object map between `Type.field` to a function(s) that will wrap the resolver of the field  */
  resolversComposition?: IResolversComposerMapping | ((config: Config) => IResolversComposerMapping);
}

/**
 * Returns a dependency injection token for getting a module's configuration object by
 * the module's name.
 * You can use this later with `@Inject` in your `Provider`s.
 *
 * @param name - the name of the module
 * @constructor
 */
export const ModuleConfig = (module: string | GraphQLModule) =>
  Symbol.for(`ModuleConfig.${typeof module === 'string' ? module : module._options.name}`);

/**
 * Represents a GraphQL module that has it's own types, resolvers, context and business logic.
 * You can read more about it in the Documentation section. TODO: Add link
 *
 * You can also specific `Config` generic to tell TypeScript what's the structure of your
 * configuration object to use later with `forRoot`
 */
export class GraphQLModule<Config = any, Request = any, Context = any> {

  /**
   * Creates a new `GraphQLModule` instance, merged it's type definitions and resolvers.
   * @param options - module configuration
   */
  constructor(
    public _options: GraphQLModuleOptions<Config, Request, Context>,
    private _moduleConfig: Config = {} as Config,
    ) {}

  /**
   * Creates another instance of the module using a configuration
   * @param config - the config object
   */
  withConfig(config: Config): GraphQLModule<Config, Request, Context> {
    return new GraphQLModule<Config, Request, Context>(this._options, config);
  }

  /**
   * Returns the list of providers of the module
   */
  get providers(): Provider[] {
    const providersDefinitions = this._options.providers;
    const providers: Provider[] = [
      {
        provide: ModuleConfig(this),
        useValue: this._moduleConfig,
      },
    ];
    if (providersDefinitions) {
      if (typeof providersDefinitions === 'function') {
        providers.push(...(providersDefinitions(this._moduleConfig)));
      } else {
        providers.push(...providersDefinitions);
      }
    }
    return [...this.imports.reduce((acc, module) => [...module.providers, ...acc], []), ...providers];
  }

  get typeDefs(): string {
    let typeDefs: any = [];
    const typeDefsDefinitions = this._options.typeDefs;
    if (typeDefsDefinitions) {
      if (typeof typeDefsDefinitions === 'function') {
        typeDefs = typeDefsDefinitions(this._moduleConfig);
      } else if (Array.isArray(typeDefsDefinitions)) {
        typeDefs = mergeGraphQLSchemas(typeDefsDefinitions);
      } else if (typeof typeDefsDefinitions === 'string') {
        typeDefs = typeDefsDefinitions;
      } else {
        typeDefs = print(typeDefsDefinitions);
      }
    }
    return mergeGraphQLSchemas([
      ...this.imports.map(module => module.typeDefs),
      typeDefs,
    ]);
  }

  get resolvers(): IResolvers {
    let resolvers: IResolvers = {};
    const resolversDefinitions = this._options.resolvers;
    if (resolversDefinitions) {
      if (typeof resolversDefinitions === 'function') {
        resolvers = resolversDefinitions(this._moduleConfig);
      } else {
        resolvers = resolversDefinitions;
      }
    }
    return mergeResolvers([
      ...this.imports.map(module => module.resolvers),
      resolvers,
    ]);
  }

  get imports() {
    let imports = new Array<GraphQLModule<any, Request, any>>();
    if (this._options.imports) {
      if (typeof this._options.imports === 'function') {
        imports = this._options.imports(this._moduleConfig);
      } else {
        imports = this._options.imports;
      }
    }
    return imports;
  }

  /**
   * Gets the application `GraphQLSchema` object.
   * If the schema object is not built yet, it compiles
   * the `typeDefs` and `resolvers` into `GraphQLSchema`
   */
  get schema() {
    return makeExecutableSchema({
      typeDefs: this.typeDefs,
      resolvers: this.resolvers,
    });
  }

  /**
   * Gets the application dependency-injection injector
   */
  get injector(): SimpleInjector {

    const injector = new Injector();
    const providers = this.providers;

    for (const provider of providers) {
      injector.provide(provider);
      injector.init(provider);
    }

    return injector;

  }

  get contextBuilder(): BuildContextFn<Request, Context> {
    const contextBuilderDefinition = this._options.contextBuilder || (() => {}) as any;
    return (request: Request, builtResult: AppContext<any>, injector: SimpleInjector) =>
     Object.assign(builtResult, contextBuilderDefinition(request,
      this.imports.reduce((acc, module) => Object.assign(acc, module.contextBuilder(request, acc, injector), builtResult)) as any, injector));
  }

  /**
   * Build a GraphQL `context` object based on a network request.
   * It iterates over all modules by their dependency-based order, and executes
   * `contextBuilder` method.
   * It also in charge of injecting a reference to the application `Injector` to
   * the `context`.
   * The network request is passed to each `contextBuilder` method, and the return
   * value of each `contextBuilder` is merged into a unified `context` object.
   *
   * This method should be in use with your GraphQL manager, such as Apollo-Server.
   *
   * @param request - the network request from `connect`, `express`, etc...
   */
  context = async (request: Request): Promise<AppContext<Context>> => {
      const injector = this.injector as Injector;
      const builtResult: AppContext<any> = {
        injector,
      };

      Object.assign(builtResult, this.contextBuilder(request, builtResult, injector));

      return builtResult;
    }
  }
