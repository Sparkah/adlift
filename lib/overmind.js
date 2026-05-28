// Overmind supervision: export AdLift's agent LLM/image spans to Overmind's
// OTLP endpoint (the same wire protocol their SDK uses) so every decision the
// agent makes is observable + optimisable. Gated on OVERMIND_API_KEY; a pure
// no-op without it. OTel libs are imported DYNAMICALLY so the app stays
// dependency-free unless tracing is actually switched on. (Overmind's own SDK
// ships alpha TypeScript that's awkward to import in Node; this hits the
// identical endpoint with the stable @opentelemetry/* packages.)

let TRACER = null, SDK = null, API = null, INIT = null;

export async function initOvermind(apiKey) {
  if (TRACER) return true;
  if (!apiKey) return false;
  if (INIT) return INIT;
  INIT = (async () => {
    try {
      const [{ NodeSDK }, { OTLPTraceExporter }, { SimpleSpanProcessor }, api] = await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-proto"),
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/api"),
      ]);
      API = api;
      if (process.env.OTEL_DEBUG) api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.DEBUG);
      const base = process.env.OVERMIND_TRACES_URL || "https://api.overmindlab.ai";
      const exporter = new OTLPTraceExporter({ url: `${base}/api/v1/traces/create`, headers: { "X-API-TOKEN": apiKey } });
      SDK = new NodeSDK({ serviceName: "adlift", spanProcessors: [new SimpleSpanProcessor(exporter)] });
      SDK.start();
      TRACER = api.trace.getTracer("adlift");
      return true;
    } catch (e) {
      if (process.env.OTEL_DEBUG) console.error("overmind init failed:", e.message);
      return false;
    }
  })();
  return INIT;
}

export const overmindOn = () => Boolean(TRACER);

// traced(name, attributes, fn) - fn receives the span so it can add completion attrs
export async function traced(name, attributes, fn) {
  if (!TRACER || !API) return fn();
  const span = TRACER.startSpan(name, { kind: API.SpanKind.CLIENT, attributes });
  try {
    const r = await fn(span);
    span.setStatus({ code: API.SpanStatusCode.OK });
    return r;
  } catch (e) {
    span.recordException(e);
    span.setStatus({ code: API.SpanStatusCode.ERROR, message: String(e?.message || e) });
    throw e;
  } finally {
    span.end();
  }
}

export async function shutdownOvermind() { try { await SDK?.shutdown(); } catch {} }
