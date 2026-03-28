import React from 'react';

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Подсветка всех вхождений подстроки (без учёта регистра). */
export function highlightSearchMatches(text: string, query: string, markClassName: string): React.ReactNode {
    const q = query.trim();
    if (!q) return text;
    const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
    const parts = text.split(re);
    return (
        <>
            {parts.map((part, i) => {
                const isMatch = part.toLowerCase() === q.toLowerCase() && part.length > 0;
                if (isMatch) {
                    return (
                        <mark key={i} className={markClassName}>
                            {part}
                        </mark>
                    );
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </>
    );
}
