// const path = require('path');
const { createBot, createProvider, createFlow, addKeyword, EVENTS, utils } = require('@builderbot/bot');
const { MemoryDB: Database } = require('@builderbot/bot');
const { BaileysProvider : Provider} = require('@builderbot/provider-baileys');

require('dotenv').config();

const PORT = process.env.PORT ?? 3008;
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
  
  const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
//   const moment = require('moment-timezone');
//   const fs = require('fs');
  
  const { GoogleAuth } = require('google-auth-library');
  const { google } = require('googleapis');
  
  const colorsByDay = {
    0: { red: 1.0, green: 0.8, blue: 0.8 },   // Domingo
    1: { red: 0.8, green: 1.0, blue: 0.8 },   // Lunes
    2: { red: 0.8, green: 0.8, blue: 1.0 },   // Martes
    3: { red: 1.0, green: 1.0, blue: 0.8 },   // Miércoles
    4: { red: 1.0, green: 0.8, blue: 1.0 },   // Jueves
    5: { red: 0.8, green: 1.0, blue: 1.0 },   // Viernes
    6: { red: 0.6, green: 0.6, blue: 0.3},   // Sábado
  };
  
  // Autenticación usando GoogleAuth
  const auth = new GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  // Mapeo de horarios a IDs de hojas
  const sheetIdsByHorario = {
    0: 1701296476, // Hoja de 10 a 12hs
    1: 207676358,  // Hoja de 14 a 15hs
    2: 491295502   // Hoja de 17 a 19hs
  };
  
  // Función para obtener el índice de la última fila
  async function getLastRowIndex(auth, spreadsheetId, sheetName) {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: `${sheetName}!A2:A`, // Comienza en A2 para saltar los títulos
    });
    return response.data.values ? response.data.values.length  : 1; // +1 para siguiente fila vacía
  }
  
  // Función principal para insertar contacto y aplicar formato de color
  async function insertContact(spreadsheetId, contactData, horarioIndex) {
    const sheetNames = ['10 a 12hs', '14 a 15hs', '17 a 19hs']; // Nombres de las hojas según horario
    const sheetName = sheetNames[horarioIndex]; // Selecciona la hoja en función del índice
  
    const sheets = google.sheets({ version: 'v4', auth });
  
    // 1. Inserta la fila de datos en la hoja correspondiente
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: `${sheetName}!A:F`, // Insertará los datos en las columnas A a F
      valueInputOption: 'RAW',
      resource: {
        values: [contactData],
      },
    });
  
    // 2. Obtener la última fila donde se insertó el contacto
    const rowIndex = await getLastRowIndex(auth, spreadsheetId, sheetName);
  
    // 3. Aplica el formato de color en la fila recién insertada
    const dayOfWeek = new Date().getDay();
    const color = colorsByDay[dayOfWeek];
  
    const requests = [{
      repeatCell: {
        range: {
          sheetId: sheetIdsByHorario[horarioIndex],
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 0, // Columna A
          endColumnIndex: 6,   // Columna F
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: {
              foregroundColor: { red: 0.0, green: 0.0, blue: 0.0 },
              fontSize: 12,
              // bold: true,
              // Aquí especificas la fuente
              fontFamily: "Nunito" // Cambia "Arial" por la fuente que prefieras
            },
            horizontalAlignment: "LEFT", // Centrado horizontal
            verticalAlignment: "MIDDLE",    // Centrado vertical
            borders: {
              bottom: {
                style: 'SOLID',
                width: 1,
                color: { red: 1, green: 1, blue: 1 }
              },
              right: {
                style: 'SOLID',
                width: 1,
                color: { red: 1, green: 1, blue: 1 }
              },
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)', // Asegúrate de que este campo esté correcto
      },
    }];
    
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests,
        },
      });
      console.log(`Contacto insertado y fila formateada con color ${JSON.stringify(color)} en la hoja ${sheetName}`);
    } catch (err) {
      console.error('Error al formatear la fila', err);
    }
  }
  
  // Ejemplo de uso en el flujo del bot
  const flujoPruebaHorario = addKeyword('!!')
    .addAction(async (ctx, { flowDynamic }) => {
  
      const currentHour = new Date().getHours();
      const today = new Date();
  
      const formattedDate = today.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const contactData = [formattedDate, '291545445', 'Carlitos', 'York', '4500', 'Inverter'];
  
      // Determinar la hoja según la hora actual
      let horarioIndex = null;
      if (currentHour >= 10 && currentHour < 12) {
        horarioIndex = 0; // Hoja de 10 a 12
      } else if (currentHour >= 13 && currentHour < 15) {
        horarioIndex = 1; // Hoja de 14 a 15
      } else if (currentHour >= 16 && currentHour < 19) {
        horarioIndex = 2; // Hoja de 17 a 19
      }
  
      if (horarioIndex !== null) {
        await insertContact('1L3F_NUof6PDdIzVYGfqn1cj9PTh1pcOHB7TCvV5jIeI', contactData, horarioIndex);
        await flowDynamic(['¡Gracias por contactarnos! Nos comunicaremos contigo en los próximos minutos.',
          {body:'Audio ejemplo', media: './src/files/audio.mp3' }
      ]);
        // await flowDynamic("¡Gracias por contactarnos! Nos comunicaremos contigo en los próximos minutos.");
      } else {
        await flowDynamic('No estamos disponibles en este momento. Podés elegir una de las siguientes franjas para que te contactemos: \n1️⃣ De 10 a 12hs\n2️⃣ De 14 a 15hs\n3️⃣ De 17 a 19hs.');
      }
    })
  
  
  const cloudinary = require('cloudinary').v2;
  
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  
  
  const formateador = new Intl.NumberFormat('es-AR', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  const apiSurair = new WooCommerceRestApi({
    url: process.env.WOOCOMMERCE_URL,
    consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
    consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
    version: "wc/v3"
  });
  
  const convertirImagen = async (imageUrl) => {
    try {
      // Verifica si la URL tiene formato webp
      if (imageUrl.endsWith('.webp')) {
        console.log('La imagen es formato WEBP. Se procede a convertir.');
  
        // Convierte la imagen a formato JPG usando Cloudinary
        const result = await cloudinary.uploader.upload(imageUrl, {
          format: 'jpg', // Convertir a JPG
          transformation: [{ quality: "auto" }] // Ajustar la calidad automáticamente
        });
  
        console.log('Imagen convertida:', result.secure_url);
        return result.secure_url; // Retornar la URL de la imagen convertida
      }
  
      // Si no es WEBP, devuelve la URL original
  
      return imageUrl;
    } catch (error) {
      console.error('Error al convertir la imagen:', error);
      throw error;
    }
  };  
  
  const buscarProductos = async (marca, tecnologia, frigorias) => {
    let productos = [];
  
    try {
      const response = await apiSurair.get('products', {
          search: `${marca} ${tecnologia} ${frigorias}`, // Incluir todos los parámetros en la búsqueda
      });
  
      productos = response.data;
  
    } catch (error) {
      // Manejo de errores de la API
      if (error.response) {
        console.log('Error al buscar productos:', error.response.status);
      } else {
        console.log('Error al buscar productos:', error.message);
      }
      throw error; // Propaga el error
    }
  
    return productos;
  };
  
  const flujoSalida = addKeyword(EVENTS.ACTION)
  .addAnswer(['↩️Saliste del cuestionario.','👩‍💻Escribime tu consulta y a la brevedad me comunicaré.','','🔄️Si quieres reiniciar, escribe *repetir*.']);
  
  const flujoFinal = addKeyword(EVENTS.ACTION)
  .addAnswer('📦Verificaré el stock disponible y a la brevedad me comunico nuevamente.\n\n¡Gracias por escribirnos!')
  .addAnswer('👇Si tienes alguna consulta adicional, hazla aquí abajo');
  
  // Flujo de selección de marca
  const flujoMarca = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic }) => {
      let marca;
      switch (true) {
        case ctx.body.includes('1'):
          marca = 'Surrey';
          break;
        case ctx.body.includes('2'):
          marca = 'Midea';
          break;
        case ctx.body.includes('3'):
          marca = 'York';
          break;
        default:
          marca = 'desconocida';
          break;
      }
  
      // Guardar la marca seleccionada en el estado del usuario
      await state.update({ marca });
  
      console.log(`Marca seleccionada: ${marca}`);
  
      // Continuar con el flujo o mostrar la respuesta al usuario
      await flowDynamic(`¡Genial! Seleccionaste la marca ${marca}.`);
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
  
      // Obtener las otras variables del estado
      const marca = await state.get('marca');
      const tecnologia = await state.get('tecnologia');
      const frigorias = await state.get('frigorias');
  
      // Mensaje final con toda la información seleccionada
      const mensajeFinal = `Gracias por responder. Ya recibí tu consulta sobre un aire con las siguientes características:\n
  🔹 *Tecnología*: ${tecnologia}\n
  🔹 *Marca*: ${marca}\n
  🔹 *Frigorías*: ${frigorias}\n\n
  ⌛Estoy buscando información de precios...`;
  
      await flowDynamic(mensajeFinal);
      await delay(500);
    })
  .addAction(async (ctx, { state, flowDynamic, endFlow,gotoFlow }) => {
  
        // Buscar productos en la API
        const marca = await state.get('marca');
        const tecnologia = await state.get('tecnologia');
        const frigorias = await state.get('frigorias');
  
        let productos = [];
        try {
        productos = await buscarProductos(marca, tecnologia, frigorias);
        } catch (error) {
          console.log('Error al procesar un producto:', error);
          return endFlow('⛓️‍💥Ups, hubo un problema al buscar el producto.\n⏱️A la brevedad me estaré comunicando para ofrecerte una alternativa.');
        }
    
        if (!productos || productos.length === 0) {
            return endFlow('🫤Por el momento no encontré un producto disponible de esas características.\n⏱️A la brevedad me estaré comunicando para ofrecerte una alternativa\n\n🔄️Si quieres repetir el cuestionario, escribe *repetir*.');
        }
        
        for (const producto of productos) {
                // console.log('Producto a procesar:', producto);
            let precio = `${producto.price}`;
            const precioFormateado = formateador.format(precio);
            let imagenUrl = producto.images[0]?.src || 'https://mediumspringgreen-antelope-284716.hostingersite.com/wp-content/uploads/2020/08/surair-logo.png';
            // Solo convierte la imagen si es de tipo webp
            let imagenConvertida = await convertirImagen(imagenUrl);
            
            await flowDynamic([
                {
                    body: `🔹 *Producto*: ${producto.name}\n💰 *Precio*: $${precioFormateado}\n🔗 *Link*: ${producto.permalink}`,
                    media: imagenConvertida, // Usar la imagen convertida o la original
                }
            ]);
        }
        return gotoFlow(flujoFinal);
    });
  
  // Flujo de selección de frigorías
  const flujoFrigorias = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic }) => {
      let frigorias;
      switch (true) {
        case ctx.body.includes('1'):
          frigorias = '2250';
          break;
        case ctx.body.includes('2'):
          frigorias = '3000';
          break;
        case ctx.body.includes('3'):
          frigorias = '4500';
          break;
        case ctx.body.includes('4'):
          frigorias = '5500';
          break;
        case ctx.body.includes('5'):
          frigorias = '7000';
          break;
        case ctx.body.includes('6'):
          frigorias = '9000';
          break;
        case ctx.body.includes('7'):
          frigorias = '15000';
          break;
        case ctx.body.includes('8'):
          frigorias = '18000';
          break;
        default:
          frigorias = 'ninguna';
          break;
      }
      // Guardar frigorías en el estado del usuario
      await state.update({ frigorias });
      console.log(`Frigorías: ${frigorias}`);
  
      await flowDynamic(`Seleccionaste ${frigorias} frigorías.`);
      return await flowDynamic('*¿Qué marca prefieres?*\n\n1️⃣ Surrey\n2️⃣ Midea\n3️⃣ York\n\n❎: Salir del cuestionario');
      // Continuar al flujo de selección de marca
    })
    .addAction(
      { capture: true }, async (ctx, { fallBack, flowDynamic, gotoFlow }) => {
        
        // Opciones válidas
        const validOptions = ['1', '2', '3', 'x'];
        const opcionesTexto = validOptions.join(' ⚡ ');
  
        const userInput = ctx.body.trim().toLowerCase();
  
        const userWords = userInput.match(/\b[^\s]+\b/g) || [];  // Coincide con palabras o números separados por espacios
    
        // Filtrar solo las palabras/números que coincidan exactamente con las opciones válidas
        const selectedOptions = userWords.filter(option => validOptions.includes(option));  
        // Si no se selecciona ninguna opción válida
        if (!selectedOptions.length) {
          await flowDynamic(`⚠️ Recuerda responder *sólo* con una opción válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Qué marca prefieres?*\n\n1️⃣ *Surrey*\n2️⃣ *Midea*\n3️⃣ *York*\n\n❎: Salir del cuestionario');
        }
    
        // Si el usuario selecciona más de una opción válida
        if (selectedOptions.length > 1) {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Qué marca prefieres?*\n\n1️⃣ *Surrey*\n2️⃣ *Midea*\n3️⃣ *York*\n\n❎: Salir del cuestionario');
        }
    
        // Si el usuario elige salir ('x')
        if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
          return gotoFlow(flujoSalida); // Dirige al flujo de salida si se elige 'x'
        }
    
        // Continuar al siguiente flujo si la opción es válida y única
        return gotoFlow(flujoMarca);
      }
    );
    
  
  // Flujo de selección de tecnología
  const flujoTecnologia = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic }) => {
      let tecnologia;
      switch (true) {
        case ctx.body.includes('1'):
          tecnologia = 'Inverter';
          break;
        case ctx.body.includes('2'):
          tecnologia = 'ON/OFF';
          break;
        default:
          tecnologia = 'ninguna';
          break;
      }
  
      // Guardar la tecnología seleccionada en el estado del usuario
      await state.update({ tecnologia });
  
      console.log(`Tecnología seleccionada: ${tecnologia}`);
  
      // Continuar con el flujo de frigorías
      let mensaje = (tecnologia == 'Inverter') ? `Seleccionaste tecnología ${tecnologia}.¡Excelente decisión! 😉` : `Seleccionaste tecnología ${tecnologia} 👌`
      await flowDynamic(`${mensaje}`);
      return await flowDynamic('*¿Cuántas frigorías?*\n\n1️⃣: 2250 (cubre 14m2)\n2️⃣: 3000 (cubre 24m2)\n3️⃣: 4500 (cubre 36m2)\n4️⃣: 5500 (cubre 44m2)\n5️⃣: 7000 (cubre 64m2)\n6️⃣: 9000 (cubre 72m2)\n7️⃣: 15000 (cubre 121m2)\n8️⃣: 18000 (cubre 144m2)\n\n❎: Salir del cuestionario');
      
  
    })
    .addAction({capture:true},async (ctx, {fallBack, flowDynamic, gotoFlow}) => {
  
        const validOptions = ['1', '2', '3','4','5','6','7','8','x'];
        const opcionesTexto = validOptions.join(' ⚡ ');
  
        const userInput = ctx.body.trim().toLowerCase();
  
        const userWords = userInput.match(/\b[^\s]+\b/g) || [];  // Coincide con palabras o números separados por espacios
    
        // Filtrar solo las palabras/números que coincidan exactamente con las opciones válidas
        const selectedOptions = userWords.filter(option => validOptions.includes(option));  
        // Verificamos si la respuesta del usuario contiene alguna de las opciones válidas
        if (!selectedOptions.length) {
            await flowDynamic (`⚠️ Recuerda responder *sólo* con:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
            return fallBack('*¿Cuántas frigorías?*\n\n1️⃣: 2250\n2️⃣: 3000\n3️⃣: 4500\n4️⃣: 7000\n5️⃣: 9000\n6️⃣: 15000\n7️⃣: 18000\n\n❎: Salir del cuestionario');
        }
    
        // Verifica si hay más de una opción válida seleccionada
        if (selectedOptions.length > 1) {
            await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
            return fallBack('*¿Cuántas frigorías?*\n\n1️⃣: 2250\n2️⃣: 3000\n3️⃣: 4500\n4️⃣: 7000\n5️⃣: 9000\n6️⃣: 15000\n7️⃣: 18000\n\n❎: Salir del cuestionario');
        }
  
        if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
          return gotoFlow(flujoSalida); 
      }
        
      return gotoFlow(flujoFrigorias);
      }
  );
  
  // Flujo principal de interacción
  
  const flowPrincipal =  addKeyword(['quiero más información','repetir'])
    .addAnswer( ['👋 Hola, bienvenido a *Surair Climatización* 😊', '📍 Nos encontramos en *Pedro Pico 276*, Bahía Blanca']
    )
    .addAnswer(['🙋‍♀️ Mi Nombre es Milva, soy asesora comercial de la empresa','¿Estás buscando algún equipo en particular?', '🤝 Voy a ayudarte con eso'])
    .addAnswer('Te comparto las opciones de pago que tenemos disponibles actualmente')
    .addAnswer('A distancia 💸', {
      media: 'https://iili.io/29qoSsI.jpg',
    })
    .addAnswer('Pago presencial 💳', {
      media: 'https://iili.io/dyr6EPt.jpg',
    })
    .addAnswer(['👉 *Responde indicando las opciones numeradas*', '','(Son sólo 3 preguntas, no te preocupes 😎) '])
    .addAnswer([
      '*Elige la tecnología que buscas*',
      '',
      '1️⃣: Inverter *(35% de ahorro energético)*',
      '2️⃣: ON/OFF',
      '',
      '❎: Salir del cuestionario '
    ], {capture:true}
    , async (ctx,{ flowDynamic, fallBack, gotoFlow}) => {
  
      const validOptions = ['1', '2', 'x']; // Cambia 'X' a 'x' para consistencia
      const opcionesTexto = validOptions.join(' ⚡ ');
      const userInput = ctx.body.trim().toLowerCase();
  
      const userWords = userInput.match(/\b[^\s]+\b/g) || [];  // Coincide con palabras o números separados por espacios
  
      // Filtrar solo las palabras/números que coincidan exactamente con las opciones válidas
      const selectedOptions = userWords.filter(option => validOptions.includes(option));
  
      // Verificamos si la respuesta del usuario contiene alguna de las opciones válidas
      if (!selectedOptions.length) {
          
          await flowDynamic(`⚠️ Recuerda responder *sólo* con:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack();
      }
  
      // Verifica si hay más de una opción válida seleccionada
      if (selectedOptions.length > 1) {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack();
      }
  
      // Si el usuario elige salir
      if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
        return gotoFlow(flujoSalida);
  
      }
      // Aquí puedes continuar con la lógica para manejar la respuesta válida
      return gotoFlow(flujoTecnologia);
  }
  );
  
  
const main = async () => {
    const adapterFlow = createFlow([flowPrincipal, flujoTecnologia, flujoFrigorias, flujoMarca, flujoFinal, flujoSalida, flujoPruebaHorario]);

    const adapterProvider = createProvider(Provider);
    const adapterDB = new Database();

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body;
            await bot.sendMessage(number, message, { media: urlMedia ?? null });
            return res.end('sended');
        })
    );

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body;
            await bot.dispatch('REGISTER_FLOW', { from: number, name });
            return res.end('trigger');
        })
    );

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body;
            await bot.dispatch('SAMPLES', { from: number, name });
            return res.end('trigger');
        })
    );

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body;
            if (intent === 'remove') bot.blacklist.remove(number);
            if (intent === 'add') bot.blacklist.add(number);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: 'ok', number, intent }));
        })
    );

    httpServer(+PORT);
};

main();
