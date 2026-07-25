import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION ?? "us-east-2";
const ddbClient = new DynamoDBClient({ region });
export const ddb = DynamoDBDocumentClient.from(ddbClient);
export const s3 = new S3Client({ region });
export const TABLE_NAME = process.env.YELLOW_TABLE ?? "yellow-app";
export const BUCKET_NAME = process.env.YELLOW_BUCKET ?? "yellow-voice-563923432327";

/**
 * Shared project hubs. Its own table (PK `hubId`) because a hub belongs to
 * *every* member, not to one account — putting it in the per-user `yellow-app`
 * blob is what made hubs invisible to everyone the creator added.
 */
export const HUBS_TABLE_NAME = process.env.YELLOW_HUBS_TABLE ?? "yellow-hubs";

/**
 * Everything posted inside a hub. Composite key (PK `hubId`, SK `itemId`) so
 * posts and tasks are independent items and one `Query` by `hubId` returns the
 * whole workspace, ordered, with no second index.
 */
export const HUB_ITEMS_TABLE_NAME =
  process.env.YELLOW_HUB_ITEMS_TABLE ?? "yellow-hub-items";
