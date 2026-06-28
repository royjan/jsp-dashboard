'use client'

import React, { useState, useEffect } from 'react'
import Tree from 'react-d3-tree'
import { Card } from '@/components/chat-admin/ui/card'
import { Button } from '@/components/chat-admin/ui/button'
import { Badge } from '@/components/chat-admin/ui/badge'
import { logger } from '@/lib/logger'

interface GraphNode {
  name: string
  type: 'letter' | 'word'
  language: string
  attributes?: {
    wordCount?: number
    connections?: string  // Serialized for react-d3-tree compatibility
    connectionCount?: number
    mappingTypes?: string  // Serialized for react-d3-tree compatibility
  }
  children?: GraphNode[]
}

export default function WordMappingGraph() {
  const [language, setLanguage] = useState<'en' | 'he' | 'ar'>('en')
  const [graphData, setGraphData] = useState<GraphNode | null>(null)
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [translate, setTranslate] = useState({ x: 400, y: 100 })
  const [zoom, setZoom] = useState(1)

  // Fetch root level graph data (all letters)
  useEffect(() => {
    fetchGraphData()
  }, [language])

  const fetchGraphData = async (letter?: string) => {
    try {
      setLoading(true)

      const params = new URLSearchParams({
        language,
        ...(letter && { letter })
      })

      const response = await fetch(`/api/admin/word-mappings/graph?${params}`)
      const data = await response.json()

      if (response.ok) {
        setGraphData(data)
        setSelectedLetter(letter || null)

        // Adjust translate based on whether we're zoomed in
        if (letter) {
          setTranslate({ x: 400, y: 50 })
          setZoom(0.8)
        } else {
          setTranslate({ x: 400, y: 100 })
          setZoom(1)
        }
      } else {
        logger.error('Failed to fetch graph data:', data.error)
      }
    } catch (error) {
      logger.error('Error fetching graph data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNodeClick = (nodeData: any) => {
    logger.info('Node clicked:', nodeData)
    if (nodeData.type === 'letter' && !selectedLetter) {
      // Drill down to show words for this letter
      logger.info('Fetching graph data for letter:', nodeData.name.toLowerCase())
      fetchGraphData(nodeData.name.toLowerCase())
    }
  }

  const handleBackToRoot = () => {
    fetchGraphData()
  }

  // Custom node rendering
  const renderCustomNode = ({ nodeDatum }: { nodeDatum: any }) => {
    const isLetter = nodeDatum.type === 'letter'
    const isWord = nodeDatum.type === 'word'

    return (
      <g>
        {/* Node circle */}
        <circle
          r={isLetter ? 30 : 20}
          fill={
            nodeDatum.language === 'he' ? '#764ba2' :
            nodeDatum.language === 'en' ? '#667eea' :
            '#4a5568'
          }
          stroke="#fff"
          strokeWidth={2}
          style={{ cursor: isLetter && !selectedLetter ? 'pointer' : 'default' }}
        />

        {/* Node label */}
        <text
          fill="#fff"
          strokeWidth={0}
          x={0}
          y={5}
          textAnchor="middle"
          fontSize={isLetter ? 16 : 12}
          fontWeight={isLetter ? 'bold' : 'normal'}
          style={{ pointerEvents: 'none' }}
        >
          {nodeDatum.name}
        </text>

        {/* Word count badge for letter nodes */}
        {isLetter && nodeDatum.attributes?.wordCount && (
          <text
            fill="#fff"
            strokeWidth={0}
            x={0}
            y={45}
            textAnchor="middle"
            fontSize={10}
            style={{ pointerEvents: 'none' }}
          >
            {nodeDatum.attributes.wordCount} words
          </text>
        )}

        {/* Connection count for word nodes */}
        {isWord && nodeDatum.attributes?.connectionCount && (
          <text
            fill="#a0aec0"
            strokeWidth={0}
            x={0}
            y={35}
            textAnchor="middle"
            fontSize={9}
            style={{ pointerEvents: 'none' }}
          >
            {nodeDatum.attributes.connectionCount} connections
          </text>
        )}
      </g>
    )
  }

  if (loading && !graphData) {
    return (
      <Card className="p-8 bg-[#1a202c] border-[#2d3748] text-center">
        <p className="text-gray-400">Loading graph...</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Controls */}
      <Card className="p-4 bg-[#1a202c] border-[#2d3748] flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Language:</span>
              <Button
                size="sm"
                variant={language === 'en' ? 'default' : 'outline'}
                onClick={() => setLanguage('en')}
              >
                English
              </Button>
              <Button
                size="sm"
                variant={language === 'he' ? 'default' : 'outline'}
                onClick={() => setLanguage('he')}
              >
                Hebrew (עברית)
              </Button>
            </div>

            {selectedLetter && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-lg">
                  {selectedLetter.toUpperCase()}
                </Badge>
                <Button size="sm" variant="outline" onClick={handleBackToRoot}>
                  ← Back to All Letters
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
            >
              Zoom In
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
            >
              Zoom Out
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setZoom(1)
                setTranslate({ x: 400, y: 100 })
              }}
            >
              Reset
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-[#2d3748]">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-[#667eea]"></div>
              <span className="text-gray-300">English</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-[#764ba2]"></div>
              <span className="text-gray-300">Hebrew</span>
            </div>
            <div className="text-gray-400 ml-4">
              {selectedLetter
                ? 'Click word nodes to see connections'
                : 'Click letter nodes to drill down'}
            </div>
          </div>
        </div>
      </Card>

      {/* Graph Visualization */}
      <Card className="bg-[#1a202c] border-[#2d3748]" style={{ height: '700px' }}>
        {graphData ? (
          <div id="treeWrapper" style={{ width: '100%', height: '100%' }}>
            <Tree
              data={graphData as any}
              orientation="vertical"
              pathFunc="step"
              translate={translate}
              zoom={zoom}
              onNodeClick={(nodeData) => handleNodeClick(nodeData.data)}
              renderCustomNodeElement={renderCustomNode}
              nodeSize={{ x: 200, y: 150 }}
              separation={{ siblings: 1.5, nonSiblings: 2 }}
              collapsible={false}
              rootNodeClassName="node__root"
              branchNodeClassName="node__branch"
              leafNodeClassName="node__leaf"
              pathClassFunc={() => 'link'}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400">No mapping data available</p>
          </div>
        )}
      </Card>

      {/* Instructions */}
      <Card className="p-4 bg-[#1a202c] border-[#2d3748]">
        <div className="text-sm text-gray-400">
          <p className="font-semibold text-gray-300 mb-2">How to use the graph:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Letter View (Root):</strong> Shows all first letters with word mappings. Click a letter to see all words starting with that letter.</li>
            <li><strong>Word View (Drilled down):</strong> Shows words and their connections. Node size indicates importance, connections show mappings.</li>
            <li><strong>Colors:</strong> Blue circles = English, Purple circles = Hebrew</li>
            <li><strong>Navigation:</strong> Use zoom controls to adjust view, click "Back to All Letters" to return to root</li>
          </ul>
        </div>
      </Card>
    </div>
  )
}
