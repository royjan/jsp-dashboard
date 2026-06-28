import React from 'react';

interface QuickSelectButtonsProps {
  examples: string[];
  onSelect: (value: string) => void;
}

export function QuickSelectButtons({ examples, onSelect }: QuickSelectButtonsProps) {
  return (
    <div className="mt-4 text-center">
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Quick select:</p>
      <div className="flex flex-wrap justify-center gap-1">
        {examples.map(example => (
          <button
            key={example}
            onClick={() => onSelect(example)}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}