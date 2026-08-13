import Link from "next/link";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export default function AuditPage() {
    return (
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
            <header className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">
                        Audit
                    </h1>
                    <p className="text-sm text-slate-500">
                        HITL events recorded by the comment_generation service.
                    </p>
                </div>
                <Link
                    href="/cohorts"
                    className="text-xs text-slate-500 hover:text-slate-700"
                >
                    ← Back to cohorts
                </Link>
            </header>
            <Card>
                <CardHeader>
                    <CardTitle>Read-only event log</CardTitle>
                    <CardDescription>
                        The dashboard does not yet expose a server-side endpoint
                        for the aggregate hitl_events table. Inspect locally
                        with{" "}
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                            sqlite3 outputs/hitl.sqlite &quot;SELECT * FROM
                            hitl_events ORDER BY id DESC LIMIT 50;&quot;
                        </code>
                        .
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-slate-500">
                        This page is reserved for the audit table once the
                        comment_generation service exposes a signed{" "}
                        <code className="text-xs">/admin/events</code> endpoint.
                    </p>
                </CardContent>
            </Card>
        </main>
    );
}
