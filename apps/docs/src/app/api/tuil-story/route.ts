const storyEndpoint =
  process.env["TUIL_STORY_ENDPOINT"] ?? "http://127.0.0.1:4317/api/tuil-story";
const allowedOrigin =
  process.env["TUIL_STORY_CORS_ORIGIN"] ?? "http://localhost:6006";

function withCors(request: Request, response: Response): Response {
  if (request.headers.get("origin") === allowedOrigin) {
    response.headers.set("access-control-allow-origin", allowedOrigin);
    response.headers.set("vary", "Origin");
  }
  return response;
}

export async function proxyStoryRequest(
  request: Request,
  endpoint = storyEndpoint,
): Promise<Response> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: await request.arrayBuffer(),
      headers: {
        "content-type":
          request.headers.get("content-type") ?? "application/json",
      },
      signal: request.signal,
    });
    return withCors(
      request,
      new Response(response.body, {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") ?? "application/json",
        },
      }),
    );
  } catch (error) {
    return withCors(
      request,
      Response.json(
        {
          error:
            error instanceof Error
              ? `Story bridge unavailable: ${error.message}`
              : "Story bridge unavailable",
        },
        { status: 502 },
      ),
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return proxyStoryRequest(request);
}

export function OPTIONS(request: Request): Response {
  return withCors(
    request,
    new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    }),
  );
}
