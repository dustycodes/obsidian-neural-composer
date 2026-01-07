import * as Popover from '@radix-ui/react-popover'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Coins,
  Cpu,
  Info,
} from 'lucide-react'

import { ResponseUsage } from '../../types/llm/response'

type LLMResponseInfoProps = {
  usage: ResponseUsage | null
  estimatedPrice: number | null
  model: string | null
}

export default function LLMResponseInfoPopover({
  usage,
  estimatedPrice,
  model,
}: LLMResponseInfoProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="clickable-icon">
          <Info size={12} />
        </button>
      </Popover.Trigger>
      {usage ? (
        <Popover.Content className="nrlcmp-popover-content nrlcmp-llm-info-content">
          <div className="nrlcmp-llm-info-header">LLM Response Information</div>
          <div className="nrlcmp-llm-info-tokens">
            <div className="nrlcmp-llm-info-tokens-header">Token Count</div>
            <div className="nrlcmp-llm-info-tokens-grid">
              <div className="nrlcmp-llm-info-token-row">
                <ArrowUp className="nrlcmp-llm-info-icon--input" />
                <span>Input:</span>
                <span className="nrlcmp-llm-info-token-value">
                  {usage.prompt_tokens}
                </span>
              </div>
              <div className="nrlcmp-llm-info-token-row">
                <ArrowDown className="nrlcmp-llm-info-icon--output" />
                <span>Output:</span>
                <span className="nrlcmp-llm-info-token-value">
                  {usage.completion_tokens}
                </span>
              </div>
              <div className="nrlcmp-llm-info-token-row nrlcmp-llm-info-token-total">
                <ArrowRightLeft className="nrlcmp-llm-info-icon--total" />
                <span>Total:</span>
                <span className="nrlcmp-llm-info-token-value">
                  {usage.total_tokens}
                </span>
              </div>
            </div>
          </div>
          <div className="nrlcmp-llm-info-footer-row">
            <Coins className="nrlcmp-llm-info-icon--footer" />
            <span>Estimated Price:</span>
            <span className="nrlcmp-llm-info-footer-value">
              {estimatedPrice === null
                ? 'Not available'
                : `$${estimatedPrice.toFixed(4)}`}
            </span>
          </div>
          <div className="nrlcmp-llm-info-footer-row">
            <Cpu className="nrlcmp-llm-info-icon--footer" />
            <span>Model:</span>
            <span className="nrlcmp-llm-info-footer-value nrlcmp-llm-info-model">
              {model ?? 'Not available'}
            </span>
          </div>
        </Popover.Content>
      ) : (
        <Popover.Content className="nrlcmp-popover-content">
          <div>Usage statistics are not available for this model</div>
        </Popover.Content>
      )}
    </Popover.Root>
  )
}
