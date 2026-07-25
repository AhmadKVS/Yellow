import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION ?? "us-east-2";
const ddbClient = new DynamoDBClient({ region });
export const ddb = DynamoDBDocumentClient.from(ddbClient);
export const s3 = new S3Client({ region });
export const TABLE_NAME = process.env.YELLOW_TABLE ?? "yellow-app";
export const BUCKET_NAME = process.env.YELLOW_BUCKET ?? "yellow-voice-563923432327";
