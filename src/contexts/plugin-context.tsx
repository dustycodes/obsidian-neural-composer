import React from 'react'

import NeuralComposerPlugin from '../main'

// Plugin context
const PluginContext = React.createContext<NeuralComposerPlugin | undefined>(
  undefined,
)

export const PluginProvider = ({
  children,
  plugin,
}: {
  children: React.ReactNode
  plugin: NeuralComposerPlugin
}) => {
  return (
    <PluginContext.Provider value={plugin}>{children}</PluginContext.Provider>
  )
}

export const usePlugin = () => {
  const plugin = React.useContext(PluginContext)
  if (!plugin) {
    throw new Error('usePlugin must be used within a PluginProvider')
  }
  return plugin
}
