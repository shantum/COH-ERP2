export default {
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: {
                    module: 'NodeNext',
                    moduleResolution: 'NodeNext',
                    target: 'ES2022',
                    allowJs: true,
                    esModuleInterop: true,
                },
            },
        ],
    },
    moduleNameMapper: {
        // Handle .js imports that point to .ts files
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testMatch: ['**/__tests__/**/*.test.js', '**/__tests__/**/*.test.ts'],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        'src/**/*.ts',
        '!src/__tests__/**',
        '!src/index.js',
    ],
    // Increase timeout for database operations
    testTimeout: 10000,
};
