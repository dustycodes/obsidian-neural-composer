import clsx from 'clsx'
import { Eye, EyeOff, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { useApp } from '../../../contexts/app-context'
import { useMcp } from '../../../contexts/mcp-context'
import { usePlugin } from '../../../contexts/plugin-context'
import { useSettings } from '../../../contexts/settings-context'
import { McpManager } from '../../../core/mcp/mcpManager'
import { McpSectionModal } from '../../modals/McpSectionModal'

export default function ToolBadge() {
  const plugin = usePlugin()
  const app = useApp()
  const { settings, setSettings } = useSettings()
  const { getMcpManager } = useMcp()

  const [mcpManager, setMcpManager] = useState<McpManager | null>(null)
  const [toolCount, setToolCount] = useState(0)

  const handleBadgeClick = useCallback(() => {
    new McpSectionModal(app, plugin).open()
  }, [plugin, app])

  const handleToolToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      // Fix: Handle floating promise from setSettings
      void setSettings({
        ...settings,
        chatOptions: {
          ...settings.chatOptions,
          enableTools: !settings.chatOptions.enableTools,
        },
      })
    },
    [settings, setSettings],
  )

  useEffect(() => {
    const initMCPManager = async () => {
      const mcpManager = await getMcpManager()
      setMcpManager(mcpManager)

      const tools = await mcpManager.listAvailableTools()
      setToolCount(tools.length)
    }
    // Fix: Handle floating promise in useEffect
    void initMCPManager()
  }, [getMcpManager])

  useEffect(() => {
    if (mcpManager) {
      // Fix: Callback expects void return, but async returns Promise.
      // Wrapped in synchronous function with void IIFE.
      const unsubscribe = mcpManager.subscribeServersChange(
        (_servers) => {
          void (async () => {
            const tools = await mcpManager.listAvailableTools()
            setToolCount(tools.length)
          })()
        },
      )
      return () => {
        unsubscribe()
      }
    }
  }, [mcpManager])

  return (
    <div
      className="nrlcmp-chat-user-input-file-badge"
      onClick={handleBadgeClick}
    >
      <div className="nrlcmp-chat-user-input-file-badge-name">
        <Wrench
          size={12}
          className="nrlcmp-chat-user-input-file-badge-name-icon"
        />
        <span
          className={clsx(
            !settings.chatOptions.enableTools && 'nrlcmp-excluded-content',
          )}
        >
          Tools ({toolCount})
        </span>
      </div>
      <div
        className="nrlcmp-chat-user-input-file-badge-eye"
        onClick={handleToolToggle}
      >
        {settings.chatOptions.enableTools ? (
          <Eye size={12} />
        ) : (
          <EyeOff size={12} />
        )}
      </div>
    </div>
  )
}