import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "@/lib/aws";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") ?? "me";

    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { userId },
      })
    );

    return Response.json({ state: result.Item?.state ?? null });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = body.userId ?? "me";
    const { state } = body;

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { userId, state, updatedAt: Date.now() },
      })
    );

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
