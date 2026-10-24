const Icon = ({ path }: { path: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const PlayIcon = () => <Icon path="M3 1.5v11L12.5 7z" />;
export const PauseIcon = () => <Icon path="M3 2h3v10H3zM8 2h3v10H8z" />;
export const PreviousFrameIcon = () => <Icon path="M1 2h2v10H1zM13 2v10L5 7z" />;
export const NextFrameIcon = () => <Icon path="M1 2v10l8-5zM11 2h2v10h-2z" />;
