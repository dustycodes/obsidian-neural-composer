import { useQuery } from '@tanstack/react-query'
import { $nodesOfType, LexicalEditor, SerializedEditorState } from 'lexical'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useSettings } from '../../../contexts/settings-context'

import { useApp } from '../../../contexts/app-context'
import {
  Mentionable,
  MentionableImage,
  SerializedMentionable,
} from '../../../types/mentionable'
import {
  deserializeMentionable,
  getMentionableKey,
  serializeMentionable,
} from '../../../utils/chat/mentionable'
import { fileToMentionableImage } from '../../../utils/llm/image'
import { openMarkdownFile, readTFileContent } from '../../../utils/obsidian'
import { ObsidianMarkdown } from '../ObsidianMarkdown'

import { ImageUploadButton } from './ImageUploadButton'
import LexicalContentEditable from './LexicalContentEditable'
import MentionableBadge from './MentionableBadge'
import { ModelSelect } from './ModelSelect'
import { MentionNode } from './plugins/mention/MentionNode'
import { NodeMutations } from './plugins/on-mutation/OnMutationPlugin'
import { SubmitButton } from './SubmitButton'
import ToolBadge from './ToolBadge'
import { VaultChatButton } from './VaultChatButton'
// Import type for safe casting
import { NeuralComposerSettings } from '../../../settings/schema/setting.types'

export type ChatUserInputRef = {
  focus: () => void
}

export type ChatUserInputProps = {
  initialSerializedEditorState: SerializedEditorState | null
  onChange: (content: SerializedEditorState) => void
  onSubmit: (content: SerializedEditorState, useVaultSearch?: boolean) => void
  onFocus: () => void
  mentionables: Mentionable[]
  setMentionables: (mentionables: Mentionable[]) => void
  autoFocus?: boolean
  addedBlockKey?: string | null
}

const ChatUserInput = forwardRef<ChatUserInputRef, ChatUserInputProps>(
  (
    {
      initialSerializedEditorState,
      onChange,
      onSubmit,
      onFocus,
      mentionables,
      setMentionables,
      autoFocus = false,
      addedBlockKey,
    },
    ref,
  ) => {
    const app = useApp()
    const { settings, setSettings } = useSettings();
    const editorRef = useRef<LexicalEditor | null>(null)
    const contentEditableRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const [displayedMentionableKey, setDisplayedMentionableKey] = useState<
      string | null
    >(addedBlockKey ?? null)

    useEffect(() => {
      if (addedBlockKey) {
        setDisplayedMentionableKey(addedBlockKey)
      }
    }, [addedBlockKey])

    useImperativeHandle(ref, () => ({
      focus: () => {
        contentEditableRef.current?.focus()
      },
    }))

    const handleMentionNodeMutation = (
      mutations: NodeMutations<MentionNode>,
    ) => {
      const destroyedMentionableKeys: string[] = []
      const addedMentionables: SerializedMentionable[] = []
      mutations.forEach((mutation) => {
        const mentionable = mutation.node.getMentionable()
        const mentionableKey = getMentionableKey(mentionable)

        if (mutation.mutation === 'destroyed') {
          const nodeWithSameMentionable = editorRef.current?.read(() =>
            $nodesOfType(MentionNode).find(
              (node) =>
                getMentionableKey(node.getMentionable()) === mentionableKey,
            ),
          )

          if (!nodeWithSameMentionable) {
            // remove mentionable only if it's not present in the editor state
            destroyedMentionableKeys.push(mentionableKey)
          }
        } else if (mutation.mutation === 'created') {
          if (
            mentionables.some(
              (m) =>
                getMentionableKey(serializeMentionable(m)) === mentionableKey,
            ) ||
            addedMentionables.some(
              (m) => getMentionableKey(m) === mentionableKey,
            )
          ) {
            // do nothing if mentionable is already added
            return
          }

          addedMentionables.push(mentionable)
        }
      })

      setMentionables(
        mentionables
          .filter(
            (m) =>
              !destroyedMentionableKeys.includes(
                getMentionableKey(serializeMentionable(m)),
              ),
          )
          .concat(
            addedMentionables
              .map((m) => deserializeMentionable(m, app))
              .filter((v) => !!v),
          ),
      )
      if (addedMentionables.length > 0) {
        setDisplayedMentionableKey(
          getMentionableKey(addedMentionables[addedMentionables.length - 1]),
        )
      }
    }

    const handleCreateImageMentionables = useCallback(
      (mentionableImages: MentionableImage[]) => {
        const newMentionableImages = mentionableImages.filter(
          (m) =>
            !mentionables.some(
              (mentionable) =>
                getMentionableKey(serializeMentionable(mentionable)) ===
                getMentionableKey(serializeMentionable(m)),
            ),
        )
        if (newMentionableImages.length === 0) return
        setMentionables([...mentionables, ...newMentionableImages])
        setDisplayedMentionableKey(
          getMentionableKey(
            serializeMentionable(
              newMentionableImages[newMentionableImages.length - 1],
            ),
          ),
        )
      },
      [mentionables, setMentionables],
    )

    const handleMentionableDelete = (mentionable: Mentionable) => {
      const mentionableKey = getMentionableKey(
        serializeMentionable(mentionable),
      )
      setMentionables(
        mentionables.filter(
          (m) => getMentionableKey(serializeMentionable(m)) !== mentionableKey,
        ),
      )

      editorRef.current?.update(() => {
        $nodesOfType(MentionNode).forEach((node) => {
          if (getMentionableKey(node.getMentionable()) === mentionableKey) {
            node.remove()
          }
        })
      })
    }

    const handleUploadImages = async (images: File[]) => {
      const mentionableImages = await Promise.all(
        images.map((image) => fileToMentionableImage(image)),
      )
      handleCreateImageMentionables(mentionableImages)
    }

    const handleSubmit = (options: { useVaultSearch?: boolean } = {}) => {
      const content = editorRef.current?.getEditorState()?.toJSON()
      if (content) {
        onSubmit(content, options.useVaultSearch)
      }
    }

    return (
      <div className="nrlcmp-chat-user-input-container" ref={containerRef}>
        <div className="nrlcmp-chat-user-input-files">
          <ToolBadge />
          {mentionables.map((m) => (
            <MentionableBadge
              key={getMentionableKey(serializeMentionable(m))}
              mentionable={m}
              onDelete={() => handleMentionableDelete(m)}
              onClick={() => {
                const mentionableKey = getMentionableKey(
                  serializeMentionable(m),
                )
                if (
                  (m.type === 'current-file' ||
                    m.type === 'file' ||
                    m.type === 'block') &&
                  m.file &&
                  mentionableKey === displayedMentionableKey
                ) {
                  openMarkdownFile(
                    app,
                    m.file.path,
                    m.type === 'block' ? m.startLine : undefined,
                  )
                } else {
                  setDisplayedMentionableKey(mentionableKey)
                }
              }}
              isFocused={
                getMentionableKey(serializeMentionable(m)) ===
                displayedMentionableKey
              }
            />
          ))}
        </div>

        <MentionableContentPreview
          displayedMentionableKey={displayedMentionableKey}
          mentionables={mentionables}
        />

        <LexicalContentEditable
          initialEditorState={(editor) => {
            if (initialSerializedEditorState) {
              editor.setEditorState(
                editor.parseEditorState(initialSerializedEditorState),
              )
            }
          }}
          editorRef={editorRef}
          contentEditableRef={contentEditableRef}
          onChange={onChange}
          onEnter={() => handleSubmit({ useVaultSearch: false })}
          onFocus={onFocus}
          onMentionNodeMutation={handleMentionNodeMutation}
          onCreateImageMentionables={handleCreateImageMentionables}
          autoFocus={autoFocus}
          plugins={{
            onEnter: {
              onVaultChat: () => {
                handleSubmit({ useVaultSearch: true })
              },
            },
            templatePopover: {
              anchorElement: containerRef.current,
            },
          }}
        />

        <div className="nrlcmp-chat-user-input-controls">
            {/* FIX: Inline styles removed (partially), replaced with class. Wrapper style kept simple or moved to CSS recommended */}
            <div className="nrlcmp-chat-user-input-controls__model-select-container">
            <ModelSelect />
            
            {/* --- CORA MOD: Selector de Modo LightRAG --- */}
            <select 
                value={settings.lightRagQueryMode}
                onChange={(e) => {
                    // FIX: Void operator for floating promise + Safe casting instead of 'any'
                    void setSettings({ 
                        ...settings, 
                        lightRagQueryMode: e.target.value as NeuralComposerSettings['lightRagQueryMode'] 
                    });
                }}
                className="nrlcmp-query-mode-select"
                title="LightRAG Enfoque"
            >
                <option value="mix">Mix</option>
                <option value="hybrid">Hybrid</option>
                <option value="local">🔍 Local</option>
                <option value="global">🌐 Global</option>
                <option value="naive">📝 Naive</option>
            </select>
            </div>
          <div className="nrlcmp-chat-user-input-controls__buttons">
            <ImageUploadButton onUpload={(files) => void handleUploadImages(files)} />
            <SubmitButton onClick={() => handleSubmit()} />
            <VaultChatButton
              onClick={() => {
                handleSubmit({ useVaultSearch: true })
              }}
            />
          </div>
        </div>
      </div>
    )
  },
)

function MentionableContentPreview({
  displayedMentionableKey,
  mentionables,
}: {
  displayedMentionableKey: string | null
  mentionables: Mentionable[]
}) {
  const app = useApp()

  const displayedMentionable: Mentionable | null = useMemo(() => {
    return (
      mentionables.find(
        (m) =>
          getMentionableKey(serializeMentionable(m)) ===
          displayedMentionableKey,
      ) ?? null
    )
  }, [displayedMentionableKey, mentionables])

  const { data: displayFileContent } = useQuery({
    enabled:
      !!displayedMentionable &&
      ['file', 'current-file', 'block'].includes(displayedMentionable.type),
    queryKey: [
      'file',
      displayedMentionableKey,
      mentionables.map((m) => getMentionableKey(serializeMentionable(m))), 
    ],
    queryFn: async () => {
      if (!displayedMentionable) return null
      if (
        displayedMentionable.type === 'file' ||
        displayedMentionable.type === 'current-file'
      ) {
        if (!displayedMentionable.file) return null
        return await readTFileContent(displayedMentionable.file, app.vault)
      } else if (displayedMentionable.type === 'block') {
        const fileContent = await readTFileContent(
          displayedMentionable.file,
          app.vault,
        )

        return fileContent
          .split('\n')
          .slice(
            displayedMentionable.startLine - 1,
            displayedMentionable.endLine,
          )
          .join('\n')
      }

      return null
    },
  })

  const displayImage: MentionableImage | null = useMemo(() => {
    return displayedMentionable?.type === 'image' ? displayedMentionable : null
  }, [displayedMentionable])

  return displayFileContent ? (
    <div className="nrlcmp-chat-user-input-file-content-preview">
      <ObsidianMarkdown content={displayFileContent} scale="xs" />
    </div>
  ) : displayImage ? (
    <div className="nrlcmp-chat-user-input-file-content-preview">
      <img src={displayImage.data} alt={displayImage.name} />
    </div>
  ) : null
}

ChatUserInput.displayName = 'ChatUserInput'

export default ChatUserInput