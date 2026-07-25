#!/usr/bin/env node
// Provisions the AWS resources Yellow needs: a DynamoDB table for app state,
// an S3 bucket (+ CORS) for voice notes, and a public-read policy on that
// bucket's `photos/` prefix for profile photos.
//
// Plain Node ESM — not part of the Next.js build. Run with:
//   node scripts/provision.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";

// --- tiny .env.local loader (avoids adding a dotenv dependency) -------------
function loadEnvLocal() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(dirname, "..", ".env.local");
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const REGION = process.env.AWS_REGION ?? "us-east-2";
const TABLE_NAME = process.env.YELLOW_TABLE ?? "yellow-app";
const BUCKET_NAME = process.env.YELLOW_BUCKET ?? "yellow-voice-563923432327";

const ddb = new DynamoDBClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

async function ensureTable() {
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    console.log(`[dynamodb] created table "${TABLE_NAME}"`);
  } catch (err) {
    if (err?.name === "ResourceInUseException") {
      console.log(`[dynamodb] table "${TABLE_NAME}" already exists`);
    } else {
      throw err;
    }
  }
}

async function ensureBucket() {
  try {
    const extraConfig =
      REGION === "us-east-1"
        ? {}
        : { CreateBucketConfiguration: { LocationConstraint: REGION } };

    await s3.send(
      new CreateBucketCommand({
        Bucket: BUCKET_NAME,
        ...extraConfig,
      })
    );
    console.log(`[s3] created bucket "${BUCKET_NAME}"`);
  } catch (err) {
    if (err?.name === "BucketAlreadyOwnedByYou") {
      console.log(`[s3] bucket "${BUCKET_NAME}" already exists`);
    } else {
      throw err;
    }
  }
}

async function ensureCors() {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ["PUT", "GET"],
            AllowedOrigins: ["http://localhost:3000", "*"],
            AllowedHeaders: ["*"],
          },
        ],
      },
    })
  );
  console.log(`[s3] CORS configured on "${BUCKET_NAME}"`);
}

// Profile photos (`photos/<ownerId>/<ts>.jpg`) are served as plain `<img src>`
// URLs, never presigned — unlike voice clips, every match sees them passively
// on every page load. That needs a bucket policy granting public GetObject,
// scoped to the `photos/` prefix only. A bucket policy alone is not enough:
// S3's account/bucket-level PublicAccessBlock silently ignores a policy that
// grants public access until BlockPublicPolicy/RestrictPublicBuckets are off.
// BlockPublicAcls/IgnorePublicAcls stay on — this uses a policy, not ACLs.
async function ensurePublicPhotos() {
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: BUCKET_NAME,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    })
  );

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PublicReadProfilePhotos",
        Effect: "Allow",
        Principal: "*",
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${BUCKET_NAME}/photos/*`,
      },
    ],
  };

  await s3.send(
    new PutBucketPolicyCommand({ Bucket: BUCKET_NAME, Policy: JSON.stringify(policy) })
  );
  console.log(`[s3] "${BUCKET_NAME}/photos/*" is public-read`);
}

async function main() {
  console.log(`Provisioning Yellow AWS resources in ${REGION}...`);
  await ensureTable();
  await ensureBucket();
  await ensureCors();
  await ensurePublicPhotos();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Provisioning failed:", err?.name ?? "Error", err?.message ?? err);
  process.exitCode = 1;
});
