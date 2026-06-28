import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '@/components/chat-admin/ui/Modal';
import { X, HelpCircle, Hash, Check, RotateCcw, Plus, Keyboard } from 'lucide-react';
import { toast } from '@/lib/toast';

interface VinPatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPattern: string;
  onSave: (pattern: string) => void;
}

interface VinSequence {
  id: string;
  positions: {[key: number]: string};
}

export function VinPatternModal({ isOpen, onClose, initialPattern, onSave }: VinPatternModalProps) {
  const [positions, setPositions] = useState<{[key: number]: string[]}>({});
  const [hoveredPosition, setHoveredPosition] = useState<number | null>(null);
  const [sequences, setSequences] = useState<VinSequence[]>([]);
  const [showSequences, setShowSequences] = useState(false);
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      // Enter to apply and close
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, positions, sequences]);

  // Parse initial pattern when modal opens
  useEffect(() => {
    if (isOpen && initialPattern && initialPattern !== '?????????????????') {
      // Show sequences if pattern has multiple options
      if (initialPattern.includes('|') || initialPattern.startsWith('(')) {
        setShowSequences(true);
      }
      
      // Check if pattern contains sequences (pattern like (VF3...|RF7...))
      if (initialPattern.startsWith('(') && initialPattern.includes('|')) {
        const seqPattern = initialPattern.slice(1, -1); // Remove outer parentheses
        const seqStrings = seqPattern.split('|');
        const newSequences: VinSequence[] = seqStrings.map((seq, index) => {
          const positions: {[key: number]: string} = {};
          for (let i = 0; i < seq.length && i < 17; i++) {
            if (seq[i] !== '?') {
              positions[i] = seq[i];
            }
          }
          return { id: `seq-${index}`, positions };
        });
        setSequences(newSequences);
        setPositions({});
      } else if (initialPattern !== '?????????????????') {
        // Convert single pattern to sequence if it has any non-wildcard characters
        const hasNonWildcard = initialPattern.split('').some(char => char !== '?');
        if (hasNonWildcard) {
          const positions: {[key: number]: string} = {};
          for (let i = 0; i < initialPattern.length && i < 17; i++) {
            if (initialPattern[i] !== '?') {
              positions[i] = initialPattern[i];
            }
          }
          setSequences([{ id: 'seq-0', positions }]);
          setPositions({});
          setShowSequences(true);
        } else {
          // Parse the pattern to extract position values
          const newPositions: {[key: number]: string[]} = {};
          for (let i = 0; i < initialPattern.length; i++) {
            const char = initialPattern[i];
            if (char === '?') {
              // Wildcard, leave empty
            } else if (char === '[') {
              // Find the closing bracket
              const closingIndex = initialPattern.indexOf(']', i);
              if (closingIndex > i) {
                const chars = initialPattern.slice(i + 1, closingIndex).split('');
                newPositions[i] = chars;
                i = closingIndex; // Skip to after the bracket
              }
            } else {
              // Single character
              newPositions[i] = [char];
            }
          }
          setPositions(newPositions);
          setSequences([]);
        }
      }
    }
  }, [isOpen, initialPattern]);

  const handlePositionChange = (position: number, value: string) => {
    const newPositions = { ...positions };
    if (value) {
      // Only allow single alphanumeric character
      const char = value.toUpperCase().slice(-1); // Take only the last character
      if (/[A-Z0-9]/.test(char)) {
        newPositions[position] = [char];
        // Auto-advance to next input
        if (position < 16 && inputRefs.current[position + 1]) {
          setTimeout(() => {
            inputRefs.current[position + 1]?.focus();
          }, 0);
        }
      }
    } else {
      delete newPositions[position];
    }
    setPositions(newPositions);
  };

  const buildPattern = () => {
    if (sequences.length > 0) {
      // Build pattern with sequences
      const patterns = sequences.map(seq => {
        let seqPattern = '';
        for (let i = 0; i < 17; i++) {
          seqPattern += seq.positions[i] || '?';
        }
        return seqPattern;
      });
      
      // If all sequences are provided, return them separated by |
      if (sequences.length > 1) {
        return `(${patterns.join('|')})`;
      }
      return patterns[0];
    }
    
    // Build pattern from individual positions
    let pattern = '';
    for (let i = 0; i < 17; i++) {
      if (positions[i] && positions[i].length > 0) {
        if (positions[i].length === 1) {
          pattern += positions[i][0];
        } else {
          pattern += `[${positions[i].join('')}]`;
        }
      } else {
        pattern += '?';
      }
    }
    return pattern;
  };

  const addSequence = () => {
    // Create a new sequence from current positions
    const newSequence: VinSequence = {
      id: Date.now().toString(),
      positions: {}
    };
    
    // Convert current positions to sequence format
    for (let i = 0; i < 17; i++) {
      if (positions[i] && positions[i].length > 0) {
        newSequence.positions[i] = positions[i].join('');
      }
    }
    
    // Check if this sequence already exists
    const isDuplicate = sequences.some(seq => {
      // Compare all positions
      for (let i = 0; i < 17; i++) {
        const seqValue = seq.positions[i] || '';
        const newValue = newSequence.positions[i] || '';
        if (seqValue !== newValue) {
          return false;
        }
      }
      return true;
    });
    
    if (isDuplicate) {
      toast.warning('This VIN sequence already exists!');
      return;
    }
    
    setSequences([...sequences, newSequence]);
    setPositions({}); // Clear current positions
  };

  const removeSequence = (id: string) => {
    setSequences(sequences.filter(seq => seq.id !== id));
  };

  const handleSave = () => {
    onSave(buildPattern());
    onClose();
  };

  const clearAll = () => {
    setPositions({});
    setSequences([]);
    setSelectedBrands(new Set());
  };

  const toggleBrand = (brand: string, prefixes: string[]) => {
    const newSelectedBrands = new Set(selectedBrands);
    
    if (selectedBrands.has(brand)) {
      // Remove brand sequences
      newSelectedBrands.delete(brand);
      setSequences(sequences.filter(seq => !seq.id.startsWith(brand.toLowerCase())));
    } else {
      // Add brand sequences
      newSelectedBrands.add(brand);
      const newSequences = prefixes.map((prefix, idx) => ({
        id: `${brand.toLowerCase()}-${idx}`,
        positions: prefix.toUpperCase().split('').reduce((acc, char, i) => ({
          ...acc,
          [i]: char
        }), {} as {[key: number]: string})
      }));
      
      // Filter out duplicates
      const uniqueNewSequences = newSequences.filter(newSeq => {
        return !sequences.some(existingSeq => {
          for (let i = 0; i < 17; i++) {
            const existingValue = existingSeq.positions[i] || '';
            const newValue = newSeq.positions[i] || '';
            if (existingValue !== newValue) {
              return false;
            }
          }
          return true;
        });
      });
      
      if (uniqueNewSequences.length === 0) {
        toast.warning('All sequences for this brand already exist!');
        return;
      }
      
      setSequences([...sequences, ...uniqueNewSequences]);
      setPositions({});
      setShowSequences(true);
    }
    
    setSelectedBrands(newSelectedBrands);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="VIN Pattern Builder"
      size="xl"
      contentClassName="h-[70vh] max-h-[500px] flex flex-col"
    >
      <div className="flex-1 overflow-y-auto px-6 pb-2">
        {/* Current Pattern Display */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Current Pattern:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSequences(!showSequences)}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
              >
                <Hash className="w-3 h-3" />
                Sequences ({sequences.length})
              </button>
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Clear
              </button>
            </div>
          </div>
          <code className="text-xs font-mono text-blue-600 dark:text-blue-400 break-all">{buildPattern()}</code>
        </div>

        {/* Help Section - Compact */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 mb-3">
          <div className="flex items-start gap-1">
            <HelpCircle className="w-3 h-3 text-blue-500 mt-0.5" />
            <div className="text-xs text-gray-700 dark:text-gray-300">
              <span className="font-medium">Tips:</span> Enter chars (auto-advance) • Empty = wildcard (?) • Press Enter to save
            </div>
          </div>
        </div>

        {/* Sequence List */}
        {showSequences && sequences.length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-2 mb-3 space-y-1">
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300">Active Sequences:</h4>
            <div className="max-h-20 overflow-y-auto space-y-0.5">
              {sequences.map((seq, index) => (
                <div key={seq.id} className="flex items-center justify-between bg-white dark:bg-gray-800 p-1 rounded text-xs">
                  <span className="font-mono">
                    {index + 1}: {Object.entries(seq.positions).map(([pos, val]) => val).join('')}...
                  </span>
                  <button
                    onClick={() => removeSequence(seq.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIN Positions Grid - Compact */}
        <div className="space-y-3">
          {/* All positions in one line */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              VIN Positions (1-17)
            </h3>
            <div className="flex gap-1 flex-wrap">
              {[...Array(17)].map((_, pos) => (
                <PositionInput
                  key={pos}
                  position={pos}
                  value={positions[pos]?.join('') || ''}
                  onChange={handlePositionChange}
                  onHover={setHoveredPosition}
                  isHovered={hoveredPosition === pos}
                  ref={(el) => {
                    if (inputRefs.current) {
                      inputRefs.current[pos] = el;
                    }
                  }}
                />
              ))}
            </div>
          </div>

          {/* Add as Sequence Button */}
          {Object.keys(positions).length > 0 && (
            <div className="flex justify-center">
              <button
                onClick={addSequence}
                className="px-3 py-1 bg-purple-500 text-white hover:bg-purple-600 rounded text-xs flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add as Sequence
              </button>
            </div>
          )}

          {/* Quick Add Brands - Compact Toggle Style */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Quick Add Brands
            </h3>
            <div className="flex flex-wrap gap-2">
              {[
                { 
                  brand: 'Peugeot', 
                  prefixes: ['VF3', 'VR3'],
                },
                { 
                  brand: 'Citroën', 
                  prefixes: ['VF7', 'VR7'],
                },
                { 
                  brand: 'Opel', 
                  prefixes: ['W0V', 'VXE', 'VSX', 'VXK', 'W0L'],
                }
              ].map(({ brand, prefixes }) => {
                const isSelected = selectedBrands.has(brand);
                
                return (
                  <button
                    key={brand}
                    onClick={() => toggleBrand(brand, prefixes)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isSelected 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {brand} ({prefixes.join(', ')})
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Actions - Fixed at bottom */}
      <div className="px-6 pb-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Keyboard className="w-3 h-3" />
            Press Enter to save
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded flex items-center gap-1 text-sm"
            >
              <Check className="w-3 h-3" />
              Apply & Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const PositionInput = React.forwardRef<HTMLInputElement, {
  position: number;
  value: string;
  onChange: (position: number, value: string) => void;
  onHover: (position: number | null) => void;
  isHovered: boolean;
}>(({ position, value, onChange, onHover, isHovered }, ref) => {
  return (
    <div
      className={`relative ${isHovered ? 'z-10' : ''}`}
      onMouseEnter={() => onHover(position)}
      onMouseLeave={() => onHover(null)}
    >
      <label className="text-[10px] text-gray-500 dark:text-gray-400 absolute -top-3 left-1/2 -translate-x-1/2">
        {position + 1}
      </label>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(position, e.target.value)}
        placeholder="?"
        className={`w-8 h-8 px-0 text-center font-mono text-xs border rounded transition-all ${
          isHovered
            ? 'border-blue-500 shadow-md scale-110 bg-blue-50 dark:bg-blue-900/20'
            : value
            ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
            : 'border-gray-300 dark:border-gray-600'
        } bg-white dark:bg-gray-800 focus:ring-1 focus:ring-blue-500 focus:border-transparent`}
      />
    </div>
  );
});

PositionInput.displayName = 'PositionInput';