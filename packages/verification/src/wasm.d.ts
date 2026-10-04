/** Vite hands a `?url` import back as the path it will be served from. */
declare module '*?url' {
  const url: string;
  export default url;
}
