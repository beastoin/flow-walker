import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentBridge, detectAgentType } from '../src/agent-bridge.ts';

describe('detectAgentType', () => {
  it('returns flutter for agent-flutter', () => {
    assert.equal(detectAgentType('agent-flutter'), 'flutter');
  });
  it('returns flutter for full path to agent-flutter', () => {
    assert.equal(detectAgentType('/usr/local/bin/agent-flutter'), 'flutter');
  });
  it('returns swift for agent-swift', () => {
    assert.equal(detectAgentType('agent-swift'), 'swift');
  });
  it('returns swift for full path to agent-swift', () => {
    assert.equal(detectAgentType('/usr/local/bin/agent-swift'), 'swift');
  });
  it('returns flutter for unknown binary', () => {
    assert.equal(detectAgentType('some-tool'), 'flutter');
  });
  it('returns swift for path containing agent-swift', () => {
    assert.equal(detectAgentType('/home/user/bin/agent-swift'), 'swift');
  });
  it('returns flutter for empty string', () => {
    assert.equal(detectAgentType(''), 'flutter');
  });
});

describe('AgentBridge constructor', () => {
  it('accepts agentType parameter', () => {
    const bridge = new AgentBridge('agent-flutter', 5000, 'flutter');
    assert.equal(bridge.getAgentType(), 'flutter');
  });
  it('accepts swift agentType', () => {
    const bridge = new AgentBridge('agent-swift', 5000, 'swift');
    assert.equal(bridge.getAgentType(), 'swift');
  });
  it('auto-detects flutter from path', () => {
    const bridge = new AgentBridge('agent-flutter');
    assert.equal(bridge.getAgentType(), 'flutter');
  });
  it('auto-detects swift from path', () => {
    const bridge = new AgentBridge('agent-swift');
    assert.equal(bridge.getAgentType(), 'swift');
  });
  it('explicit agentType overrides auto-detect', () => {
    const bridge = new AgentBridge('agent-flutter', 5000, 'swift');
    assert.equal(bridge.getAgentType(), 'swift');
  });
  it('defaults to agent-flutter if no args', () => {
    const bridge = new AgentBridge();
    assert.equal(bridge.getAgentType(), 'flutter');
  });
});
