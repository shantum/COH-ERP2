import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

/** Recursive JSON value type */
type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };

interface JsonViewerProps {
    data: JsonValue;
    rootName?: string;
}

interface JsonNodeProps {
    name: string;
    value: JsonValue;
    depth: number;
    initialExpanded?: boolean;
}

function JsonNode({ name, value, depth, initialExpanded = false }: JsonNodeProps) {
    const [expanded, setExpanded] = useState(initialExpanded || depth < 1);

    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);
    const isEmpty = isObject && Object.keys(value).length === 0;

    const indent = depth * 16;

    // Render primitive values
    if (!isObject) {
        return (
            <div className="flex items-start py-0.5" style={{ paddingLeft: indent }}>
                <span className="text-purple-400 mr-1">{name}:</span>
                {typeof value === 'string' ? (
                    <span className="text-green-400">"{value}"</span>
                ) : typeof value === 'number' ? (
                    <span className="text-blue-400">{value}</span>
                ) : typeof value === 'boolean' ? (
                    <span className="text-yellow-400">{value ? 'true' : 'false'}</span>
                ) : value === null ? (
                    <span className="text-gray-500">null</span>
                ) : (
                    <span className="text-gray-400">{String(value)}</span>
                )}
            </div>
        );
    }

    // Empty object/array
    if (isEmpty) {
        return (
            <div className="flex items-start py-0.5" style={{ paddingLeft: indent }}>
                <span className="text-purple-400 mr-1">{name}:</span>
                <span className="text-gray-500">{isArray ? '[]' : '{}'}</span>
            </div>
        );
    }

    const entries = Object.entries(value);
    const previewText = isArray
        ? `[${entries.length} items]`
        : `{${entries.length} keys}`;

    return (
        <div>
            <div
                className="flex items-start py-0.5 cursor-pointer hover:bg-gray-800 rounded"
                style={{ paddingLeft: indent }}
                onClick={() => setExpanded(!expanded)}
            >
                <span className="mr-1 text-gray-500 flex-shrink-0">
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="text-purple-400 mr-1">{name}:</span>
                {!expanded && (
                    <span className="text-gray-500 text-xs">{previewText}</span>
                )}
            </div>
            {expanded && (
                <div>
                    {entries.map(([key, val], index) => (
                        <JsonNode
                            key={`${key}-${index}`}
                            name={isArray ? `[${key}]` : key}
                            value={val}
                            depth={depth + 1}
                            initialExpanded={depth < 0}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function JsonViewer({ data, rootName = 'data' }: JsonViewerProps) {
    const [expandAll, setExpandAll] = useState(false);
    const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree');

    if (data === null || data === undefined) {
        return <span className="text-gray-500">null</span>;
    }

    return (
        <div className="bg-gray-900 rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                <div className="flex gap-2">
                    <button
                        onClick={() => setViewMode('tree')}
                        className={`px-2 py-1 text-xs rounded ${viewMode === 'tree' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        Tree View
                    </button>
                    <button
                        onClick={() => setViewMode('raw')}
                        className={`px-2 py-1 text-xs rounded ${viewMode === 'raw' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        Raw JSON
                    </button>
                </div>
                {viewMode === 'tree' && (
                    <button
                        onClick={() => setExpandAll(!expandAll)}
                        className="text-xs text-gray-400 hover:text-white"
                    >
                        {expandAll ? 'Collapse All' : 'Expand All'}
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="p-3 text-xs font-mono max-h-[500px] overflow-auto">
                {viewMode === 'tree' ? (
                    <div key={expandAll ? 'expanded' : 'collapsed'}>
                        {Array.isArray(data) ? (
                            data.map((item, index) => (
                                <JsonNode
                                    key={index}
                                    name={`[${index}]`}
                                    value={item}
                                    depth={0}
                                    initialExpanded={expandAll || index < 3}
                                />
                            ))
                        ) : (
                            <JsonNode
                                name={rootName}
                                value={data}
                                depth={0}
                                initialExpanded={expandAll || true}
                            />
                        )}
                    </div>
                ) : (
                    <pre className="text-green-400 whitespace-pre-wrap">
                        {JSON.stringify(data, null, 2)}
                    </pre>
                )}
            </div>
        </div>
    );
}
