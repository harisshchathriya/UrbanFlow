import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4?target=deno'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const hour = new Date().getHours()

  const time_bucket =
    hour < 12 ? 'morning' :
    hour < 18 ? 'afternoon' :
    'evening'

  const zones = [
    { zone: 'T. Nagar', base: 'high' },
    { zone: 'Guindy', base: 'high' },
    { zone: 'Anna Nagar', base: 'medium' },
    { zone: 'Adyar', base: 'medium' },
    { zone: 'Marina Beach', base: 'low' },
  ]

  const rows = zones.map(z => {
    let vehicle_count = 0
    let activity_level = z.base

    if (z.base === 'high') {
      vehicle_count = 80 + Math.floor(Math.random() * 40)
    } else if (z.base === 'medium') {
      vehicle_count = 40 + Math.floor(Math.random() * 30)
    } else {
      vehicle_count = 10 + Math.floor(Math.random() * 15)
    }

    // Slight fluctuation
    if (Math.random() > 0.7) {
      activity_level =
        activity_level === 'high' ? 'medium' :
        activity_level === 'medium' ? 'high' :
        'low'
    }

    return {
      zone: z.zone,
      activity_level,
      vehicle_count,
      time_bucket,
    }
  })

  const { error } = await supabase
    .from('freight_zones')
    .insert(rows)

  if (error) {
    return new Response(JSON.stringify(error), { status: 500 })
  }

  return new Response(
    JSON.stringify({
      status: 'Freight zones updated',
      zones: rows.length,
      time_bucket
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})


//npx supabase functions deploy generate-freight-zones