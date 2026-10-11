import assert from 'node:assert/strict';
import test from 'node:test';
import { performInteraction } from './measure-startup.mjs';

const keyboardAction = {
  type: 'press',
  selector: 'moving-button',
  key: 'Enter',
  acknowledge: { selector: 'opened-card', state: 'visible' },
};

function pageProbe(options = {}) {
  const events = [];
  const target = {
    waitFor: async () => {
      events.push('target:visible');
    },
    evaluate: async (_predicate, requireViewport) => {
      events.push(`target:presented:${requireViewport}`);
      return options.targetPresented !== false;
    },
    isEnabled: async () => {
      events.push('target:enabled');
      return options.enabled !== false;
    },
    press: async (key) => {
      events.push(`key:${key}`);
    },
    click: async () => {
      events.push('click');
      if (options.clickError) throw options.clickError;
    },
  };
  const acknowledgement = {
    waitFor: async () => {
      events.push('ack:visible');
      if (options.ackError) throw options.ackError;
    },
    evaluate: async (_predicate, requireViewport) => {
      events.push(`ack:presented:${requireViewport}`);
      return options.ackPresented !== false;
    },
  };
  return {
    events,
    page: {
      locator: (selector) => (selector === 'moving-button' ? target : acknowledgement),
      evaluate: async () => {
        events.push('paint');
      },
      waitForTimeout: async () => {},
    },
  };
}

function failureAt(phase) {
  return (error) => error.name === 'StartupInteractionError' && error.phase === phase;
}

test('native keyboard activation requires presented/enabled target and presented acknowledgement', async () => {
  const { page, events } = pageProbe();
  const result = await performInteraction(page, keyboardAction, 100);
  assert.equal(result.acknowledged, true);
  assert.ok(Number.isFinite(result.driverActionToAcknowledgedPaintMs));
  const dispatched = events.indexOf('key:Enter');
  assert.ok(dispatched > events.indexOf('target:presented:true'));
  assert.ok(dispatched > events.indexOf('target:enabled'));
  assert.ok(events.indexOf('ack:presented:true') > dispatched);
  assert.equal(events.at(-1), 'paint');
  assert.ok(!events.includes('click'), 'Keyboard evidence must not become a synthetic click');
});

test('a disabled keyboard target is rejected before input', async () => {
  const { page, events } = pageProbe({ enabled: false });
  await assert.rejects(performInteraction(page, keyboardAction, 100), failureAt('target-enabled'));
  assert.ok(!events.includes('key:Enter'));
  assert.ok(!events.includes('paint'));
});

test('a target that never becomes presented cannot receive keyboard input', async () => {
  const { page, events } = pageProbe({ targetPresented: false });
  await assert.rejects(
    performInteraction(page, keyboardAction, 5),
    failureAt('target-presentation'),
  );
  assert.ok(!events.includes('key:Enter'));
});

test('a matched but unpresented acknowledgement remains a failed interaction', async () => {
  const { page, events } = pageProbe({ ackPresented: false });
  await assert.rejects(
    performInteraction(page, keyboardAction, 5),
    failureAt('acknowledgment-presentation'),
  );
  assert.ok(events.includes('key:Enter'));
  assert.ok(!events.includes('paint'));
});

test('selector-match failures preserve the phase without raw browser details', async () => {
  const raw = new Error('private selector /accounts/fixture-id?token=do-not-report');
  const { page } = pageProbe({ ackError: raw });
  await assert.rejects(performInteraction(page, keyboardAction, 100), (error) => {
    assert.equal(error.phase, 'acknowledgment-match');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /fixture-id|token|do-not-report/);
    return true;
  });
});

test('click actionability/dispatch failures are distinct from acknowledgement failures', async () => {
  const { page, events } = pageProbe({ clickError: new Error('raw actionability detail') });
  await assert.rejects(
    performInteraction(page, { ...keyboardAction, type: 'click' }, 100),
    failureAt('action-dispatch'),
  );
  assert.ok(!events.includes('ack:visible'));
});
