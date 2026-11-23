// Astro SSR application on Node (archetype B-admin, shape `node-http`): one call of `astroPipeline` in image mode from the eSoul Jenkins
// libraries (`pipelines/vars/astroPipeline.txt`). It runs the checks of the Astro guideline in disposable containers (install, audit,
// lint, format, type check, unit tests, build, `pnpm verify`), then, on the deploy branches, builds the multi-architecture image and
// rolls it out with `deployKomodoStack`.
//
// Unlike the static frontends, this image has a runtime (Node, `src/server/`, `node_modules`), so its `Dockerfile` builds from source
// (`pnpm build && pnpm verify` inside the build stage) and the pipeline does not hand it a verified `dist/`: `useVerifiedBuild: false`.
// The Dockerfile builds the `production` target and takes the public origin as the build argument `SITE_URL`, which is baked into
// `security.allowedDomains`; the checks get the same value through `env`, so `pnpm verify` compares the same domain.
//
// Adopting the template: set `image` (lowercase letters, digits, `_`, `.`, `-`; pushed to the `registry` namespace), `stack` (the
// Komodo stack deployed after the push; drop it and nothing is deployed) and the public origin in both places below. One origin and
// one set of tags per job: a second environment with its own domain is a second job, because the origin is baked into the image.
// Credentials (Jenkins): `scaleway_secret_key`, `komodo_deploy_api_key`, `komodo_deploy_api_secret`.
//
// The Playwright specs (`pnpm test:e2e`, every spec starts its own server) are not part of the pipeline: the step runs them only in a
// pinned Playwright image (`checks: [smoke: [enabled: true, image: '<image>']]`, the version of `@playwright/test` in package.json),
// and that image has to run the Node of this template (see `.nvmrc`); run them locally with `pnpm build && pnpm test:e2e`.
@Library(['dockerHelpers', 'testing', 'deploy', 'pipelines']) _

astroPipeline(
    mode: 'image',
    image: 'replace-with-app-name',
    stack: 'replace-with-komodo-stack',
    nodeImage: 'node:26',
    env: [
        // Public origin of the application: the checks verify the build against it.
        SITE_URL: 'https://replace-with-domain.example',
    ],
    // The same origin as a build argument of the image (never a secret).
    buildArgs: [SITE_URL: 'https://replace-with-domain.example'],
    dockerfile: 'Dockerfile',
    target: 'production',
    useVerifiedBuild: false,
    checks: [test: true],
    // The deploy branches push `latest`; every Git tag at the commit is a tag of the image too.
    tags: ['latest'],
    deployBranches: ['main', 'master'],
)
