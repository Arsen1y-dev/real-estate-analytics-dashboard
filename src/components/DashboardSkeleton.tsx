import React from 'react';

function ShimmerBlock({ className }: { className: string }) {
    return (
        <div
            className={`animate-pulse rounded-xl bg-gradient-to-r from-zinc-800 via-zinc-700/80 to-zinc-800 bg-[length:200%_100%] ${className}`}
            style={{ animationDuration: '1.5s' }}
        />
    );
}

export const DashboardSkeleton: React.FC = () => (
    <div className="min-h-screen bg-zinc-950 px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1580px] space-y-10">
            <div className="rounded-[1.75rem] border border-zinc-800/80 bg-zinc-950/80 p-8 sm:p-10">
                <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                        <ShimmerBlock className="h-8 w-3/4 max-w-md" />
                        <ShimmerBlock className="h-4 w-full max-w-xl" />
                        <ShimmerBlock className="h-4 w-5/6 max-w-lg" />
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        <ShimmerBlock className="h-10 w-36" />
                        <ShimmerBlock className="h-10 w-32" />
                    </div>
                </div>
                <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5">
                            <ShimmerBlock className="mb-3 h-3 w-24" />
                            <ShimmerBlock className="h-8 w-32" />
                            <ShimmerBlock className="mt-4 h-12 w-full rounded-lg" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="flex min-h-[22rem] flex-col rounded-3xl border border-zinc-800/70 bg-zinc-900/30 p-5">
                        <ShimmerBlock className="mb-4 h-5 w-2/3" />
                        <ShimmerBlock className="min-h-0 flex-1 rounded-2xl" />
                        <ShimmerBlock className="mt-4 h-10 w-full rounded-lg" />
                    </div>
                ))}
            </div>
        </div>
        <p className="mx-auto mt-10 max-w-[1580px] text-center text-sm font-medium text-zinc-500">Загрузка и разбор CSV…</p>
    </div>
);
