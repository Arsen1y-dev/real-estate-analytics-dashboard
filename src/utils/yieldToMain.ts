/** Даёт React отрисовать скелетон/лоадер до тяжёлой работы на главном потоке. */
export function yieldToMain(): Promise<void> {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
            setTimeout(resolve, 0);
        }
    });
}
