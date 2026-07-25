# Deploying Yellow to AWS Amplify Hosting

> **Timebox this to 15 minutes.** The demo runs from `localhost`. Amplify is a
> nice-to-have. If you hit anything you can't fix in one build cycle, jump to
> [Fallback](#8-fallback-if-this-fights-us) and move on.

---

## 0. Read this first: Next.js 16 is not officially supported

**AWS's docs do not list Next.js 16 as a supported version.** They say Amplify
Hosting compute supports **Next.js 12 through 15**:

> "You can deploy apps built with Next.js versions up through Next.js 15"
> — [Amplify support for Next.js](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)

This app is on **Next.js 16.2.11**. What that means in practice:

| | Status |
|---|---|
| Officially supported / AWS will support-ticket it | **No** |
| Works in practice today | **Usually yes**, for App Router + npm |

Next.js 16.1 shipped a Turbopack change that made Amplify's bundler fail with
`EEXIST: file already exists ... .next/node_modules/<pkg>-<hash>`. AWS fixed it
on their side and closed the issue on **2026-02-17**; multiple reporters
confirmed App Router apps then deployed with no workaround
([amplify-hosting#4074](https://github.com/aws-amplify/amplify-hosting/issues/4074)).
The reports still open on that theme are **pnpm monorepos** — Yellow is neither,
so the odds are good.

**Decision:** it's worth 15 minutes. It is not worth debugging past that. AWS
will not have your back if the platform itself chokes on Next 16.

---

## 1. Prerequisites

- [ ] Repo pushed to **GitHub** (Amplify builds from a connected branch — an
      uncommitted `amplify.yml` will not be used).
- [ ] `amplify.yml` and `package-lock.json` **committed**. `npm ci` fails hard if
      the lockfile is stale — if other agents added deps, run `npm install` and
      commit the updated lockfile before pushing.
- [ ] Node **20.9+** (Amplify's AL2023 build image defaults to Node 22, which is
      fine. Amplify *blocks* SSR builds on Node 14/16/18 as of 2025-09-15.
      [ref](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html))
- [ ] AWS resources already live in **us-east-2**, account **563923432327**:
  - DynamoDB table **`yellow-app`**, partition key `userId` (String)
  - S3 bucket **`yellow-voice-563923432327`**
  - Bedrock **Anthropic Claude model access enabled** in us-east-2
    (Bedrock console → Model access → Anthropic → Enabled). Model access is
    per-region and is a separate thing from IAM — you need both.

---

## 2. Connect the repo and deploy

Do this in **us-east-2** — check the region selector top-right before you start.
(`lib/aws.ts` falls back to `us-east-2` if `AWS_REGION` is unset, so keeping the
app in us-east-2 makes both code paths agree. See §4.)

1. [Amplify console](https://console.aws.amazon.com/amplify/) → **Create new app**
2. Choose **GitHub** → authorize → **Next**
3. Pick the **repo** and the **branch** (`master`) → **Next**
4. **Build settings** — Amplify should show it detected **Next.js - SSR** and
   read `amplify.yml` from the repo root. Confirm this before continuing.
   - If it says **Static** / `WEB` instead of `WEB_COMPUTE`, stop and see
     [Troubleshooting A](#a-pages-load-but-every-apiroute-404s--the-static-trap).
5. **Service role** — choose **Create and use a new service role**.
   ⚠️ This is *not* the role your API routes use. It only lets Amplify build and
   deploy on your behalf. The runtime role is a separate thing — see §3.
6. **Next** → **Save and deploy**

Steps mirror
[Deploying a Next.js SSR application to Amplify](https://docs.aws.amazon.com/amplify/latest/userguide/deploy-nextjs-app.html).

While it builds (~3-5 min), do §3 — you'll need it before the API routes work.

---

## 3. IAM — the part that actually matters

**Read this even if you skim everything else.**

`lib/aws.ts` constructs its clients with only a region and no credentials:

```ts
const ddbClient = new DynamoDBClient({ region });
export const s3 = new S3Client({ region });
```

That means the AWS SDK v3 **default credential provider chain** resolves them.
Locally that hits your `~/.aws/credentials`. **In Amplify there is no such file** —
credentials come from the **SSR Compute role**, and if you don't attach one, every
API route throws `CredentialsProviderError` or `AccessDenied` while your pages
render perfectly. That asymmetry is what makes this failure confusing.

### Two different roles — don't mix them up

| Role | Set during | Used by | Needs your DynamoDB/S3/Bedrock perms? |
|---|---|---|---|
| **Service role** (app-level IAM service role) | App creation (§2 step 5) | Amplify's build/deploy control plane | **No** |
| **SSR Compute role** | App settings → IAM roles | **Your running API routes** | **Yes — this one** |

The Compute role's credentials are injected into the SSR function's runtime and
picked up automatically by the default chain — **no code change needed**
([AWS blog](https://aws.amazon.com/blogs/mobile/iam-compute-roles-for-server-side-rendering-with-aws-amplify-hosting/)).

### 3a. Create the policy

IAM console → **Policies** → **Create policy** → **JSON** tab → paste → name it
`YellowAmplifyComputePolicy` → **Create policy**.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "YellowDynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-2:563923432327:table/yellow-app"
    },
    {
      "Sid": "YellowS3Objects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::yellow-voice-563923432327/*"
    },
    {
      "Sid": "YellowBedrockClaude",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        "arn:aws:bedrock:::foundation-model/anthropic.*",
        "arn:aws:bedrock:*:563923432327:inference-profile/*.anthropic.*"
      ]
    }
  ]
}
```

Notes on that policy:

- **S3 resource ends in `/*`** — that's the *objects* ARN. `GetObject`/`PutObject`
  act on objects, not the bucket. A bucket ARN without `/*` will 403.
- **Bedrock is wildcarded across regions on purpose.** Modern Claude models are
  invoked through cross-region inference profiles (`us.anthropic.*`,
  `global.anthropic.*`), and AWS requires that *"when you specify an inference
  profile in the `Resource` field ... you must also specify the foundation model
  in each Region associated with it"*
  ([Prerequisites for inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)).
  Pinning to a single region here is the #1 way to get a surprise
  `AccessDeniedException` at demo time. It's still scoped to Anthropic models
  only, in this one account.
- If the code presigns S3 URLs (`@aws-sdk/s3-request-presigner` is a dependency),
  no extra permission is needed — signing is local. But a URL signed with role
  credentials dies when that role session expires, so keep expiries short.

### 3b. Create the role

IAM console → **Roles** → **Create role** → **Custom trust policy**. Paste this
exactly — a wrong trust policy makes the Amplify console reject the role with a
non-obvious error:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Statement1",
      "Effect": "Allow",
      "Principal": {
        "Service": [
          "amplify.amazonaws.com"
        ]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Next** → attach `YellowAmplifyComputePolicy` → **Next** → name it
`YellowAmplifyComputeRole` → **Create role**.

### 3c. Attach it to the app

1. Amplify console → your app
2. Navigation pane → **App settings** → **IAM roles**
3. **Compute role** section → **Edit**
4. **Default role** → select `YellowAmplifyComputeRole`
5. **Save**

Role changes take effect **without a redeploy**. Source:
[Adding an SSR Compute role](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html).

---

## 4. Environment variables

### The `AWS_*` gotcha — you cannot set `AWS_REGION`

> "Amplify doesn't allow you to create environment variable names with an `AWS`
> prefix. This prefix is reserved for Amplify internal use only."
> — [Using environment variables in an Amplify application](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html)

The console will reject `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY` outright. Amplify owns that namespace (`AWS_APP_ID`,
`AWS_BRANCH`, `AWS_COMMIT_ID`, …).

**Recommendation: do nothing.** Don't try to set `AWS_REGION`, and don't rename
it in code. Two independent things already make it correct:

1. The SSR compute function is a Lambda, and the Lambda runtime sets `AWS_REGION`
   itself to the region it runs in — us-east-2, if you created the app there (§2).
2. `lib/aws.ts` already falls back: `process.env.AWS_REGION ?? "us-east-2"`.

And **never** set static AWS keys as env vars — that's exactly what the Compute
role replaces.

### What to actually set

**Nothing is strictly required.** `lib/aws.ts` defaults `YELLOW_TABLE` to
`yellow-app` and `YELLOW_BUCKET` to `yellow-voice-563923432327`, which are the
real resources. Under time pressure, **skip this section entirely.**

If you want them explicit: Amplify console → **App settings** →
**Environment variables** → **Manage variables** → add:

| Name | Value |
|---|---|
| `YELLOW_TABLE` | `yellow-app` |
| `YELLOW_BUCKET` | `yellow-voice-563923432327` |

⚠️ Console env vars are visible to the **build**, not to the **SSR runtime** —
that's deliberate, to stop build secrets leaking into the server bundle. The
`amplify.yml` in this repo already handles it with:

```
- env | grep -e YELLOW_ -e NEXT_PUBLIC_ >> .env.production || true
```

Any new server-read variable must either start with `YELLOW_`/`NEXT_PUBLIC_` or
be added to that grep, otherwise it will be `undefined` at request time.
([SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html))

---

## 5. Verify the deploy end to end

A green build proves nothing about the API routes. Check all four:

1. **Platform is right.** App settings → **General settings** → **App settings**
   → **Platform** must read **Next.js - SSR** (`WEB_COMPUTE`), not **Static**
   (`WEB`). If it's Static, nothing under `app/api/` exists.
2. **Page loads.** Open `https://<branch>.<app-id>.amplifyapp.com` — the UI renders.
3. **API route runs.** From a terminal (substitute the real URL):
   ```bash
   curl -i https://<branch>.<app-id>.amplifyapp.com/api/state
   ```
   - `200` (body `{"state":null}` on a fresh table) → the compute function is
     alive and the IAM role works. This is the check that matters.
   - `404` → you deployed a static site. → [Troubleshooting A](#a-pages-load-but-every-apiroute-404s--the-static-trap)
   - `500` → the route ran but AWS calls failed. → [Troubleshooting B](#b-pages-work-api-routes-return-500--the-iam-trap)

   Use **`/api/state`** specifically — it's the only route wired to AWS.
   `/api/extract` and `/api/audio` are stubs that return **501 by design**; a 501
   from those is not a deploy problem. A `404` from them, though, still means the
   static trap.
4. **Data actually lands.** Exercise the flow in the browser (whatever writes
   state), then DynamoDB console → **Tables** → `yellow-app` → **Explore table
   items** → **Run** and confirm a new item with your `userId`. This is the only
   check that proves credentials → network → table all work.

If a route 500s, read the real error: Amplify console → your branch → the
deployment → **Hosting compute logs** (CloudWatch). Don't guess.

---

## 6. Troubleshooting

### A. Pages load but every `/api/*` 404s — the static trap
**Cause:** `artifacts.baseDirectory` is `out` instead of `.next`, so Amplify
deployed a static export. There is no server, so route handlers don't exist. This
fails *silently* — the build goes green.
**Fix:** confirm `amplify.yml` has `baseDirectory: .next` (it does — don't
"correct" it to `out`), and that `next.config.ts` has **no** `output: 'export'`.
Note that `amplify.yml` in the repo **overrides** whatever the console shows —
if you edited build settings in the console, they're being ignored.
Then redeploy and re-check Platform per §5.1.

### B. Pages work, API routes return 500 — the IAM trap
**Cause:** no SSR Compute role attached, or its policy is too narrow. Compute
logs will show `CredentialsProviderError`, `AccessDeniedException`, or
`is not authorized to perform: dynamodb:PutItem`.
**Fix:** §3. Most common sub-cases:
- Attached the *service role* instead of the *Compute role* → §3c.
- S3 ARN missing the trailing `/*` → §3a.
- Bedrock pinned to one region while the model uses a cross-region inference
  profile → use the wildcard block in §3a.
- `AccessDeniedException` from Bedrock even with correct IAM → **model access was
  never enabled** in the Bedrock console for us-east-2. IAM and model access are
  two separate gates.

### C. Build fails with `EEXIST ... .next/node_modules/<pkg>-<hash>`
**Cause:** the Next 16.1+ Turbopack symlink issue
([#4074](https://github.com/aws-amplify/amplify-hosting/issues/4074)). AWS fixed
this in Feb 2026, so you should not hit it — if you do, the platform is behind.
**Fix:** don't fight it. This is the exact scenario for
[Fallback](#8-fallback-if-this-fights-us).

### D. Build fails on TypeScript errors
`next build` still fails the build on type errors (Next 16 dropped `next lint`
and no longer lints during build, but it **does** still typecheck). With several
agents writing code in parallel this is a live risk.
**Fix (fastest):** reproduce locally with `npm run build` and fix the type error.
**Fix (escape hatch, needs a code change I did not make):** add to `next.config.ts`:
```ts
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
};
```
Only do this if the error is cosmetic and the demo is minutes away.

### E. Build fails at `npm ci`
**Cause:** `package-lock.json` out of sync with `package.json` (agents added a
dependency without committing the lockfile).
**Fix:** locally run `npm install`, commit **both** `package.json` and
`package-lock.json`, push. Do not switch `amplify.yml` to `npm install` — you'd
trade a clear error for a nondeterministic build.

### F. Node version error
`❌ NODE.JS VERSION NOT SUPPORTED` means the app is on the old Amazon Linux 2
build image.
**Fix:** App settings → **Build settings** → **Build image settings** → switch to
**Amazon Linux 2023** (default Node 22). If you must pin, add `- nvm use 20` as
the first `preBuild` command.

### G. Build fails with an out-of-memory error
**Fix:** temporarily remove `.next/cache/**/*` from `cache.paths` in
`amplify.yml`, rebuild, then add it back once it's green.
([ref](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html))

### H. Audio route returns 504 or empty
Amplify caps SSR HTTP responses at **5.72 MB** and does **not** support Next.js
streaming or Edge runtime routes. If `/api/audio` pipes bytes through the route
handler, large clips will 504.
**Fix:** return a **presigned S3 URL** and let the browser fetch the object
directly from S3 (`@aws-sdk/s3-request-presigner` is already a dependency).
Also make sure no route exports `runtime = 'edge'` — Amplify doesn't support it
and it fails the build.

---

## 7. Things I could not do for you

I only own `amplify.yml` and `DEPLOY.md`. These are **outside** the console and
require someone else to act:

1. **Commit and push** `amplify.yml` + `package-lock.json` to GitHub. Amplify
   reads the build spec from the repo, not from your disk.
2. **`next.config.ts`** — only if you need the §6D `ignoreBuildErrors` escape hatch.
3. **Bedrock model access** in us-east-2 — console toggle, not IAM, not code.
4. **Bucket CORS** on `yellow-voice-563923432327` if the browser uploads or
   fetches presigned URLs directly from the amplifyapp.com origin. Localhost may
   already be allowed while the deployed origin is not.

---

## 8. Fallback: if this fights us

**Stop at 15 minutes.** The demo runs from `localhost` and this deploy is
explicitly non-blocking.

You are done trying if any of these is true:
- Two consecutive builds fail for different reasons
- You hit the `EEXIST` Turbopack bundler error (§6C) — that's a platform bug
- Platform still shows **Static** after fixing `baseDirectory` and redeploying
- You're 15 minutes in without a working `/api/state`

Then:
```bash
npm run dev
```
Demo on `http://localhost:3000`. Your local `.env.local` and shared AWS
credentials already work against the same real DynamoDB table, S3 bucket, and
Bedrock models — the demo is *identical* in substance. Leave the Amplify app
sitting there; it costs nothing and you can finish it after the presentation.

---

## Sources

- [Amplify support for Next.js](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html) — supported version range, supported/unsupported features
- [Deploying a Next.js SSR application to Amplify](https://docs.aws.amazon.com/amplify/latest/userguide/deploy-nextjs-app.html) — `baseDirectory: .next`, console steps
- [Adding an SSR Compute role](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html) — trust policy, console navigation
- [IAM Compute Roles for SSR (AWS blog)](https://aws.amazon.com/blogs/mobile/iam-compute-roles-for-server-side-rendering-with-aws-amplify-hosting/) — default credential chain behavior
- [Using environment variables in an Amplify application](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html) — `AWS` prefix restriction
- [Making environment variables accessible to server-side runtimes](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html) — `.env.production` pattern
- [Troubleshooting SSR applications](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-SSR.html) — Node versions, size/response limits, OOM
- [Troubleshooting general Amplify issues](https://docs.aws.amazon.com/amplify/latest/userguide/troubleshooting-general.html#update-node-version) — AL2023 build image, Node versions
- [Prerequisites for inference profiles (Bedrock)](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html) — cross-region inference IAM
- [amplify-hosting#4074](https://github.com/aws-amplify/amplify-hosting/issues/4074) — Next.js 16.1 Turbopack symlink bundling bug and its fix
