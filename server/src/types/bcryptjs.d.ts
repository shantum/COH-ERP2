declare module 'bcryptjs' {
    export function genSalt(rounds: number): Promise<string>;
    export function genSalt(rounds?: number, callback?: (err: Error, salt: string) => void): void;
    export function genSaltSync(rounds?: number): string;
    export function hash(s: string, salt: string | number): Promise<string>;
    export function hash(s: string, salt: string | number, callback?: (err: Error, hash: string) => void): void;
    export function hashSync(s: string, salt?: string | number): string;
    export function compare(s: string, hash: string): Promise<boolean>;
    export function compare(s: string, hash: string, callback?: (err: Error, success: boolean) => void): void;
    export function compareSync(s: string, hash: string): boolean;
    export function getRounds(hash: string): number;
}
