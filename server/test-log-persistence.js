/**
 * Test script to verify log persistence across restarts
 *
 * Usage:
 * 1. Run: node test-log-persistence.js write
 *    - Creates test logs and saves them to file
 * 2. Run: node test-log-persistence.js read
 *    - Reads logs from file to verify persistence
 */

import logBuffer from './src/utils/logBuffer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];

if (command === 'write') {
    console.log('\n=== Writing test logs ===\n');

    // Add some test logs
    logBuffer.addLog('info', 'Test info log 1', { test: true, timestamp: Date.now() });
    logBuffer.addLog('warn', 'Test warning log', { test: true, severity: 'medium' });
    logBuffer.addLog('error', 'Test error log', { test: true, error: 'Something went wrong' });
    logBuffer.addLog('info', 'Test info log 2', { test: true, data: { foo: 'bar' } });
    logBuffer.addLog('debug', 'Test debug log', { test: true, details: 'debugging info' });

    console.log('Added 5 test logs to buffer');

    // Wait for async writes to complete
    setTimeout(async () => {
        // Force flush any pending writes
        if (logBuffer.writeQueue && logBuffer.writeQueue.length > 0) {
            console.log('Flushing pending writes...');
            await logBuffer._processWriteQueue();
        }

        // Show stats
        const stats = logBuffer.getStats();
        console.log('\nLog Statistics:');
        console.log(`Total logs: ${stats.total}`);
        console.log(`By level:`, stats.byLevel);

        // Check file
        const logFilePath = path.resolve(__dirname, 'logs/server.jsonl');
        const fileExists = fs.existsSync(logFilePath);
        console.log(`\nLog file exists: ${fileExists}`);

        if (fileExists) {
            const fileContent = fs.readFileSync(logFilePath, 'utf-8');
            const lines = fileContent.trim().split('\n').filter(l => l.trim());
            console.log(`Log file has ${lines.length} entries`);

            // Show last 3 entries
            console.log('\nLast 3 log entries:');
            lines.slice(-3).forEach((line, idx) => {
                const log = JSON.parse(line);
                console.log(`${idx + 1}. [${log.level.toUpperCase()}] ${log.message}`);
            });
        }

        console.log('\n✅ Test logs written successfully!');
        console.log('Now run: node test-log-persistence.js read\n');

        process.exit(0);
    }, 1000);

} else if (command === 'read') {
    console.log('\n=== Reading logs (simulating restart) ===\n');

    // Wait a moment for initialization to complete
    setTimeout(() => {
        // The logBuffer is already initialized and should have loaded logs from file
        const stats = logBuffer.getStats();
        console.log('Log Statistics after restart:');
        console.log(`Total logs: ${stats.total}`);
        console.log(`By level:`, stats.byLevel);

        // Get ALL logs and search for test logs
        const { logs, total } = logBuffer.getLogs({ limit: 1000 });

        console.log(`\n${total} total logs in buffer`);

        // Check for our test logs
        const testLogs = logs.filter(l => l.context && l.context.test === true);
        if (testLogs.length > 0) {
            console.log(`\n✅ Found ${testLogs.length} test log(s) from previous run - persistence working!\n`);
            console.log('Test logs found:');
            testLogs.forEach((log, idx) => {
                console.log(`${idx + 1}. [${log.level.toUpperCase()}] ${log.message}`);
            });
        } else {
            console.log('\n⚠️  No test logs found - they may have been cleaned up or not written');
        }

        // Show most recent 5 logs
        console.log('\nMost recent 5 logs overall:');
        logs.slice(0, 5).forEach((log, idx) => {
            const contextStr = Object.keys(log.context).length > 0
                ? ` | Context: ${JSON.stringify(log.context).substring(0, 50)}...`
                : '';
            console.log(`${idx + 1}. [${log.level.toUpperCase()}] ${log.message}${contextStr}`);
        });

        console.log('\n');
        process.exit(0);
    }, 500);

} else {
    console.log('\nUsage:');
    console.log('  node test-log-persistence.js write   # Write test logs');
    console.log('  node test-log-persistence.js read    # Read logs after restart\n');
    process.exit(1);
}
