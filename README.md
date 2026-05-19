# App de evaluación de exposiciones entre estudiantes

Aplicación web local/desplegable en Render para que el profesor active la evaluación de una exposición y los estudiantes evalúen a su compañero desde celular, laptop o tablet.

## Funciones principales

- Registro de estudiantes usando la lista del grupo.
- Panel del profesor protegido con PIN.
- Activación/cierre de la evaluación del ponente actual.
- Evaluación con 4 criterios en escala 1 a 5:
  1. Dominio del tema.
  2. Desempeño como ponente.
  3. Cumplimiento con diagramas de flujo, código y conceptos básicos.
  4. Cumplimiento de tiempo de exposición, 20 a 25 minutos.
- Impide que un estudiante se evalúe a sí mismo.
- Impide doble evaluación del mismo ponente por el mismo evaluador.
- Estadísticas por ponente y por evaluador.
- Exportación CSV de evaluaciones y estadísticas.
- Persistencia local en `data/eval-db.json`.

## Correr localmente

```bash
cd peer_eval_app
npm install
npm start
```

Abrir:

```text
http://localhost:3000
```

Panel docente:

```text
http://localhost:3000/teacher
```

PIN por defecto:

```text
1234
```

Para cambiar el PIN al arrancar:

```bash
TEACHER_PIN=9876 npm start
```

## Uso durante clase

1. El profesor entra a `/teacher`.
2. El profesor selecciona el ponente y pulsa **Activar evaluación**.
3. Los estudiantes entran a `/`, seleccionan su nombre y evalúan.
4. El profesor puede ver promedios en tiempo real.
5. Al terminar, el profesor pulsa **Cerrar evaluación** o activa el siguiente ponente.
6. Puede descargar CSV desde el panel.

## Despliegue en Render

Configuración sugerida:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Environment variable:
  TEACHER_PIN=tu_pin
```

Nota: en Render Free el almacenamiento local puede perderse al reiniciar/redeployar. Para un uso formal persistente se recomienda migrar `eval-db.json` a Supabase/Postgres.
