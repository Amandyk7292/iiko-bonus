import PageState from '../components/PageState';
import TaplinkBuilderView from './taplink/TaplinkBuilderView';
import { useTaplinkBuilder } from './taplink/use-taplink-builder';
import '../styles/taplink.css';

export default function TaplinkPage({ canPublish = true }: { canPublish?: boolean }) {
  const builder = useTaplinkBuilder();

  if (builder.loading) return <PageState type="loading" />;
  if (builder.error || !builder.state)
    return (
      <PageState
        type="error"
        description={builder.error}
        onRetry={() => void builder.actions.reload()}
      />
    );

  return (
    <TaplinkBuilderView
      state={builder.state}
      actions={builder.actions}
      canPublish={canPublish}
    />
  );
}
