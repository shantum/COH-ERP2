/** Build slug from product name + UUID */
export function buildProductSlug(name: string, id: string): string {
    const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${nameSlug}--${id}`;
}
