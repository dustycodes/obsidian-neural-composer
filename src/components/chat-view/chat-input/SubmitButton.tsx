import { CornerDownLeftIcon } from 'lucide-react'

export function SubmitButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="nrlcmp-chat-user-input-submit-button" onClick={onClick}>
      <div className="nrlcmp-chat-user-input-submit-button-icons">
        <CornerDownLeftIcon size={12} />
      </div>
      <div>Chat</div>
    </div>
  )
}
