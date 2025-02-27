import * as path from 'path';
import { pascal } from 'case';
import { Eslint, Project } from '..';
import { Component } from '../component';
import { FileBase } from '../file';
import { Bundler, BundlingOptions } from '../javascript/bundler';
import { SourceCode } from '../source-code';
import { TYPESCRIPT_LAMBDA_EXT } from './internal';

const { basename, dirname, extname, join, relative } = path.posix;

/**
 * Common options for `LambdaFunction`. Applies to all functions in
 * auto-discovery.
 */
export interface LambdaFunctionCommonOptions {
  /**
   * The node.js version to target.
   *
   * @default Runtime.NODEJS_14_X
   */
  readonly runtime?: LambdaRuntime;

  /**
   * Bundling options for this AWS Lambda function.
   *
   * If not specified the default bundling options specified for the project
   * `Bundler` instance will be used.
   *
   * @default - defaults
   */
  readonly bundlingOptions?: BundlingOptions;
}

/**
 * Options for `Function`.
 */
export interface LambdaFunctionOptions extends LambdaFunctionCommonOptions {
  /**
   * A path from the project root directory to a TypeScript file which contains
   * the AWS Lambda handler entrypoint (exports a `handler` function).
   *
   * This is relative to the root directory of the project.
   *
   * @example "src/subdir/foo.lambda.ts"
   */
  readonly entrypoint: string;

  /**
   * The name of the generated TypeScript source file. This file should also be
   * under the source tree.
   *
   * @default - The name of the entrypoint file, with the `-function.ts` suffix
   * instead of `.lambda.ts`.
   */
  readonly constructFile?: string;

  /**
   * The name of the generated `lambda.Function` subclass.
   *
   * @default - A pascal cased version of the name of the entrypoint file, with
   * the extension `Function` (e.g. `ResizeImageFunction`).
   */
  readonly constructName?: string;
}

/**
 * Generates a pre-bundled AWS Lambda function construct from handler code.
 *
 * To use this, create an AWS Lambda handler file under your source tree with
 * the `.lambda.ts` extension and add a `LambdaFunction` component to your
 * typescript project pointing to this entrypoint.
 *
 * This will add a task to your "compile" step which will use `esbuild` to
 * bundle the handler code into the build directory. It will also generate a
 * file `src/foo-function.ts` with a custom AWS construct called `FooFunction`
 * which extends `@aws-cdk/aws-lambda.Function` which is bound to the bundled
 * handle through an asset.
 *
 * @example
 *
 * new LambdaFunction(myProject, {
 *   srcdir: myProject.srcdir,
 *   entrypoint: 'src/foo.lambda.ts',
 * });
 */
export class LambdaFunction extends Component {
  /**
   * Defines a pre-bundled AWS Lambda function construct from handler code.
   *
   * @param project The project to use
   * @param options Options
   */
  constructor(project: Project, options: LambdaFunctionOptions) {
    super(project);

    const bundler = Bundler.of(project);
    if (!bundler) {
      throw new Error('No bundler found. Please add a Bundler component to your project.');
    }

    const runtime = options.runtime ?? LambdaRuntime.NODEJS_14_X;

    // allow Lambda handler code to import dev-deps since they are only needed
    // during bundling
    const eslint = Eslint.of(project);
    eslint?.allowDevDeps(options.entrypoint);

    const entrypoint = options.entrypoint;

    if (!entrypoint.endsWith(TYPESCRIPT_LAMBDA_EXT)) {
      throw new Error(`${entrypoint} must have a ${TYPESCRIPT_LAMBDA_EXT} extension`);
    }

    const basePath = join(dirname(entrypoint), basename(entrypoint, TYPESCRIPT_LAMBDA_EXT));
    const constructFile = options.constructFile ?? `${basePath}-function.ts`;

    if (extname(constructFile) !== '.ts') {
      throw new Error(`Construct file name "${constructFile}" must have a .ts extension`);
    }

    // type names
    const constructName = options.constructName ?? pascal(basename(basePath)) + 'Function';
    const propsType = `${constructName}Props`;

    const bundle = bundler.addBundle(entrypoint, {
      target: runtime.esbuildTarget,
      platform: runtime.esbuildPlatform,
      externals: ['aws-sdk'],
      ...options.bundlingOptions,
    });

    // calculate the relative path between the directory containing the
    // generated construct source file to the directory containing the bundle
    // index.js by resolving them as absolute paths first.
    // e.g:
    //  - outfileAbs => `/project-outdir/assets/foo/bar/baz/foo-function/index.js`
    //  - constructAbs => `/project-outdir/src/foo/bar/baz/foo-function.ts`
    const outfileAbs = join(project.outdir, bundle.outfile);
    const constructAbs = join(project.outdir, constructFile);
    const relativeOutfile = relative(dirname(constructAbs), dirname(outfileAbs));

    const src = new SourceCode(project, constructFile);
    src.line(`// ${FileBase.PROJEN_MARKER}`);
    src.line('import * as path from \'path\';');
    src.line('import * as lambda from \'@aws-cdk/aws-lambda\';');
    src.line('import { Construct } from \'@aws-cdk/core\';');
    src.line();
    src.line('/**');
    src.line(` * Props for ${constructName}`);
    src.line(' */');
    src.open(`export interface ${propsType} extends lambda.FunctionOptions {`);
    src.close('}');
    src.line();
    src.line('/**');
    src.line(` * An AWS Lambda function which executes ${basePath}.`);
    src.line(' */');
    src.open(`export class ${constructName} extends lambda.Function {`);
    src.open(`constructor(scope: Construct, id: string, props?: ${propsType}) {`);
    src.open('super(scope, id, {');
    src.line(`description: '${entrypoint}',`);
    src.line('...props,');
    src.line(`runtime: lambda.Runtime.${runtime.functionRuntime},`);
    src.line('handler: \'index.handler\',');
    src.line(`code: lambda.Code.fromAsset(path.join(__dirname, '${relativeOutfile}')),`);
    src.close('});');
    src.close('}');
    src.close('}');

    this.project.logger.verbose(`${basePath}: construct "${constructName}" generated under "${constructFile}"`);
    this.project.logger.verbose(`${basePath}: bundle task "${bundle.bundleTask.name}"`);
    if (bundle.watchTask) {
      this.project.logger.verbose(`${basePath}: bundle watch task "${bundle.watchTask.name}"`);
    }
  }
}

/**
 * The runtime for the AWS Lambda function.
 */
export class LambdaRuntime {
  /**
   * Node.js 10.x
   */
  public static readonly NODEJS_10_X = new LambdaRuntime('NODEJS_10_X', 'node10');

  /**
   * Node.js 12.x
   */
  public static readonly NODEJS_12_X = new LambdaRuntime('NODEJS_12_X', 'node12');

  /**
   * Node.js 14.x
   */
  public static readonly NODEJS_14_X = new LambdaRuntime('NODEJS_14_X', 'node14');

  public readonly esbuildPlatform = 'node';

  private constructor(
    /**
     * The aws-lambda.Runtime member name to use.
     */
    public readonly functionRuntime: string,

    /**
     * The esbuild setting to use.
     */
    public readonly esbuildTarget: string) {
  }
}