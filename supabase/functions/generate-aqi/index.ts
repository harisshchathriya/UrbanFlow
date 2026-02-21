import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4?target=deno'

serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const areas = [
    'T. Nagar',
    'Anna Nagar',
    'Guindy',
    'Adyar',
    'Marina Beach',
  ]

  const rows = areas.map(area => ({
    area,
    aqi: Math.floor(50 + Math.random() * 100),
    source: 'simulated',
  }))

  const { error } = await supabase.from('aqi_readings').insert(rows)

  if (error) {
    return new Response(JSON.stringify(error), { status: 500 })
  }

  return new Response(
    JSON.stringify({ status: 'AQI updated', rows: rows.length }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
