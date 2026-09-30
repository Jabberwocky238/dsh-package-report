// Static assets are served by the assets binding; anything else is not found.
export default {
  fetch() {
    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
