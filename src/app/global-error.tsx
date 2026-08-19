"use client";

/**
 * Last-resort boundary: catches errors in the root layout itself, where
 * the app's CSS may not have loaded — hence inline styles and no shared
 * components. Everything else uses `error.tsx`.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: "100vh",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#faf9f7",
                    color: "#1f2430",
                    fontFamily:
                        "system-ui, -apple-system, 'Segoe UI', sans-serif",
                }}
            >
                <div style={{ maxWidth: 380, padding: 24, textAlign: "center" }}>
                    <h1 style={{ fontSize: 18, marginBottom: 8 }}>
                        Something went wrong
                    </h1>
                    <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
                        The page hit an unexpected error. Trying again usually
                        fixes it.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{
                            marginTop: 16,
                            padding: "8px 16px",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "#ffffff",
                            background: "#1f2430",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                        }}
                    >
                        Try again
                    </button>
                    {error.digest && (
                        <p style={{ marginTop: 16, fontSize: 11, opacity: 0.5 }}>
                            Error reference: {error.digest}
                        </p>
                    )}
                </div>
            </body>
        </html>
    );
}
