/**
 * Dev sandbox for the v2 GenerationForm with the Tiptap-based RichTextarea
 * + Active Wildcards integration. Mounts the full form tree with the
 * providers it needs (`GenerationFormProvider`, `IsClient`) so the editor
 * can be exercised in real form context — controllers, graph store, watch
 * dependencies — without the surrounding app shell.
 *
 * Wildcard sets are now added via the in-form "Add wildcard set" button
 * (resource select modal filtered to `Wildcards`-type models) — no URL
 * params, no hardcoded defaults. `skipStorage` keeps test runs from
 * polluting the production form's localStorage.
 *
 * Mirrors the host setup used by `/dev/data-graph-v2`. Dev-only.
 */

import { Container } from '@mantine/core';
import { NotFound } from '~/components/AppLayout/NotFound';
import { IsClient } from '~/components/IsClient/IsClient';
import { GenerationForm } from '~/components/generation_v2/GenerationForm';
import { GenerationFormProvider } from '~/components/generation_v2/GenerationFormProvider';
import { isDev } from '~/env/other';

function PromptSnippetsDevPage() {
  if (!isDev) return <NotFound />;

  return (
    <Container size="xs" className="h-screen max-h-screen w-full overflow-hidden px-0 py-3">
      <IsClient>
        <GenerationFormProvider debug skipStorage>
          <GenerationForm />
        </GenerationFormProvider>
      </IsClient>
    </Container>
  );
}

PromptSnippetsDevPage.standalone = true;

export default PromptSnippetsDevPage;
