const { createBot, createProvider, createFlow, addKeyword, EVENTS, utils } = require('@builderbot/bot');
const { MemoryDB: Database } = require('@builderbot/bot');
const { BaileysProvider : Provider} = require('@builderbot/provider-baileys');
const PORT = process.env.PORT ?? 3008;
const delay = (ms) => new Promise((res) => setTimeout(res, ms)); 
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const cloudinary = require('cloudinary').v2;


require('dotenv').config();

const usersBlocked =[];

function isBahiaBlanca(phoneNumber) {
  return phoneNumber.startsWith('549291');
}

const horarioAtencion = {
  0: '10 a 12 hs',
  1: '14 a 15 hs',
  2: '17 a 19 hs',
}

function isOutOfSchedule() {
  const now = new Date();
  const day = now.getDay(); 
  const hour = now.getHours();
  return day === 0 || day === 6 || (day === 5 && hour >= 19);
}

const colorsByDay = {
  0: { red: 1.0, green: 0.8, blue: 0.8 },   // Domingo
  1: { red: 0.8, green: 1.0, blue: 0.8 },   // Lunes
  2: { red: 0.8, green: 0.8, blue: 1.0 },   // Martes
  3: { red: 1.0, green: 1.0, blue: 0.8 },   // Miércoles
  4: { red: 1.0, green: 0.8, blue: 1.0 },   // Jueves
  5: { red: 0.8, green: 1.0, blue: 1.0 },   // Viernes
  6: { red: 0.6, green: 0.6, blue: 0.3},   // Sábado
};

const credenciales = (process.env.GOOGLE_CREDENTIALS_JSON);
// console.log(credenciales);
const credentials = JSON.parse(credenciales);

const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Mapeo de horarios a IDs de hojas
const sheetIdsByHorario = {
  0: 1701296476, // Hoja de 10 a 12hs
  1: 207676358,  // Hoja de 14 a 15hs
  2: 491295502   // Hoja de 17 a 19hs
};
  
async function getLastRowIndex(auth, spreadsheetId, sheetName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: `${sheetName}!A2:A`, // Comienza en A2 para saltar los títulos
  });
  return response.data.values ? response.data.values.length  : 1; 
}
  
async function insertContact(spreadsheetId, contactData, horarioIndex) {
  const sheetNames = ['10 a 12hs', '14 a 15hs', '17 a 19hs']; // Nombres de las hojas según horario
  const sheetName = sheetNames[horarioIndex]; 
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: `${sheetName}!A:G`, 
      valueInputOption: 'RAW',
      resource: {
        values: [contactData],
      },
    });

    const rowIndex = await getLastRowIndex(auth, spreadsheetId, sheetName);

    const dayOfWeek = new Date().getDay();
    const color = colorsByDay[dayOfWeek];

    const requests = [{
      repeatCell: {
        range: {
          sheetId: sheetIdsByHorario[horarioIndex],
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 0, // Columna A
          endColumnIndex: 7,   // Columna G
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: {
              foregroundColor: { red: 0.0, green: 0.0, blue: 0.0 },
              fontSize: 12,
              fontFamily: "Nunito"
            },
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
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
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)',
      },
    }];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests },
    });

    console.log(`Contacto insertado y fila formateada con color ${JSON.stringify(color)} en la hoja ${sheetName}`);
    return true;

  } catch (err) {
    console.error('Error al insertar contacto o formatear la fila:', err);
    return false;
  }
}
  
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

    if (imageUrl.endsWith('.webp')) {
      // console.log('La imagen es formato WEBP. Se procede a convertir.');

      // Convierte la imagen a formato JPG usando Cloudinary
      const result = await cloudinary.uploader.upload(imageUrl, {
        format: 'jpg', 
        transformation: [{ quality: "auto" }] 
      });

      // console.log('Imagen convertida:', result.secure_url);
      return result.secure_url; 
    }
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
        search: `${marca} ${tecnologia} ${frigorias}`, 
    });

    productos = response.data;

  } catch (error) {
    // Manejo de errores de la API
    if (error.response) {
      console.log('Error al buscar productos:', error.response.status);
    } else {
      console.log('Error al buscar productos:', error.message);
    }
    throw error; 
  }

  return productos;
};
/////// INICIO DE FLUJOS DE CONVERSACIÓN /////// 
const flujoSalida = addKeyword(EVENTS.ACTION)
.addAnswer(['↩️Saliste del cuestionario.','👩‍💻Escribime tu consulta y a la brevedad me comunicaré.','','🔄️Si quieres reiniciar, escribe *repetir*.']);


const flujoCargaDatos = addKeyword(EVENTS.ACTION)
.addAction(async (ctx, { state, blacklist, endFlow }) => {
  const formattedDate = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const numero = ctx.from.substring(3);
  const nombre = ctx.name;
  const marca = state.get('marca');
  const tecnologia = state.get('tecnologia');
  const frigorias = state.get('frigorias');
  const medio = state.get('medio');
  const horario = state.get('horario');
  const horarioTexto = horarioAtencion[horario];


  const contactData = [formattedDate, numero, nombre, marca, frigorias, tecnologia, medio];
  // console.log(contactData);

  const isInserted = await insertContact('1L3F_NUof6PDdIzVYGfqn1cj9PTh1pcOHB7TCvV5jIeI', contactData, horario);

  if (!isInserted) {
    return endFlow('🥴Lo siento, tuvimos un inconveniente al procesar tus datos.\n🧐Igualmente voy a chequearlos y me comunico dentro de los horarios de atención.\n\n¡Gracias por contactarnos!');
  } else {
    blacklist.add(ctx.from); 
    return endFlow(`📝Excelente, ya anoté todo.\n\nMe comunicaré dentro del horario indicado, de *${horarioTexto}*👈📞.\n\n👩‍🦳¡Gracias por contactarnos!`);
  }
});

const flujoFinalMedio = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic, gotoFlow }) => {
  
      let medio;
      switch (true) {
        case ctx.body.includes('1'):
          medio = 'Mensaje';
          break;
        case ctx.body.includes('2'):
          medio = 'Llamada';
          break;
        default:
          medio = 'desconocido';
          break;
      }
      await state.update({ medio });

      await flowDynamic(`Seleccionaste ${medio}\n\n⌛Dame un momento...✍️`);
      await utils.delay(3000);

      return gotoFlow(flujoCargaDatos);

    })

const flujoFinalHorario = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { flowDynamic, state }) => {
  
      let horario;
      switch (true) {
        case ctx.body.includes('1'):
          horario = 0;
          break;
        case ctx.body.includes('2'):
          horario = 1;
          break;
        case ctx.body.includes('3'):
          horario = 2;
          break;
        default:
          horario = 'desconocida';
          break;
      }
      await state.update({ horario });
      const horarioElegido = horarioAtencion[horario];

      await utils.delay(3000);

      await flowDynamic([`Seleccionaste ${horarioElegido}`, `*¿Prefieres por mensaje o llamada?*\n\n1️⃣ Mensaje\n2️⃣ Llamada\n\n❎Salir del cuestionario`])

    })
    .addAction(
      { capture: true }, async (ctx, { fallBack, flowDynamic, gotoFlow }) => {
        
        const validOptions = ['1', '2', 'x'];
        const opcionesTexto = validOptions.join(' ⚡ ');
    
        const userInput = ctx.body.trim().toLowerCase();
    
        const userWords = userInput.match(/\b[^\s]+\b/g) || [];  

        const selectedOptions = userWords.filter(option => validOptions.includes(option));  
        if (!selectedOptions.length) {
          await flowDynamic(`⚠️ Recuerda responder *sólo* con una opción válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Prefieres por mensaje o llamada?*\n\n1️⃣ Mensaje\n2️⃣ Llamada\n\n❎Salir del cuestionario');
        }
    
        if (selectedOptions.length > 1) {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Prefieres por mensaje o llamada?*\n\n1️⃣ Mensaje\n2️⃣ Llamada\n\n❎Salir del cuestionario');
        }
    
        if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
          return gotoFlow(flujoSalida); 
        }
    
        return gotoFlow(flujoFinalMedio);
      }
    );  
  const flujoFinal = addKeyword(EVENTS.ACTION)
  .addAction(async (ctx, { flowDynamic}) => {
    await utils.delay(3000);

    if (isOutOfSchedule()) {
      
      await flowDynamic(`*Por favor, selecciona un horario en el que podamos comunicarnos personalmente*\n(⚠️ El horario elegido corre a partir del lunes)\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario`);
    }else {
      await flowDynamic('*Por favor, selecciona un horario en el que podamos comunicarnos personalmente*\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario')
    }
    }
  )
  .addAction(
    { capture: true }, async (ctx, { fallBack, flowDynamic, gotoFlow }) => {
 
      const validOptions = ['1', '2', '3', 'x'];
      const opcionesTexto = validOptions.join(' ⚡ ');

      const userInput = ctx.body.trim().toLowerCase();

      const userWords = userInput.match(/\b[^\s]+\b/g) || []; 
  
      const selectedOptions = userWords.filter(option => validOptions.includes(option));  

      if (!selectedOptions.length) {
        if (isOutOfSchedule()) {
          await flowDynamic(`⚠️ Recuerda responder *sólo* con una opción válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack(`*Por favor, selecciona un horario en el que podamos comunicarnos personalmente*\n(⚠️ El horario elegido corre a partir del lunes)\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario`);
  
        }else {
          await flowDynamic(`⚠️ Recuerda responder *sólo* con una opción válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*Por favor, selecciona un horario en el que podamos comuniarnos personalmente*\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario');
          }
      }
  
      if (selectedOptions.length > 1) {
        if (isOutOfSchedule()) {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack(`*Por favor, selecciona un horario en el que podamos comunicarnos personalmente*\n(⚠️ El horario elegido corre a partir del lunes)\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario`);
  
        }else {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*Por favor, selecciona un horario en el que podamos comuniarnos personalmente*\n\n1️⃣ 10 a 12 hs\n2️⃣ 14 a 15 hs\n3️⃣ 17 a 19 hs\n\n❎Salir del cuestionario');
          }
      }
  
      if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
        return gotoFlow(flujoSalida); 
      }
  
      return gotoFlow(flujoFinalHorario);
    }
  );

  const flujoMarca = addKeyword(EVENTS.ACTION)
    .addAction(async (ctx, { state, flowDynamic }) => {
        const marcas = ['Surrey', 'Midea', 'York'];
        let marcaIndex;

        switch (true) {
            case ctx.body.includes('1'):
                marcaIndex = 0;
                break;
            case ctx.body.includes('2'):
                marcaIndex = 1; 
                break;
            case ctx.body.includes('3'):
                marcaIndex = 2;
                break;
            default:
                marcaIndex = -1; 
                break;
        }

        const marca = marcas[marcaIndex] || 'desconocida';
        await state.update({ marcaIndex, marcaInicial: marca, marca });
        console.log(`Marca seleccionada: ${marca}`);
        // const estado = state.getMyState();
        // console.log(estado);

        await flowDynamic(`¡Genial! Seleccionaste la marca ${marca}.`);
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        const marca = await state.get('marca');
        const tecnologia = await state.get('tecnologia');
        const frigorias = await state.get('frigorias');

        const mensajeFinal = `Gracias por responder. Ya recibí tu consulta sobre un aire con las siguientes características:\n
🔹 *Marca*: ${marca}\n
🔹 *Tecnología*: ${tecnologia}\n
🔹 *Frigorías*: ${frigorias}\n\n
⌛Estoy buscando el producto en nuestra página...`;
    
        await utils.delay(3000);

        await flowDynamic(mensajeFinal);
      })
    .addAction(async (ctx, { state, flowDynamic, endFlow, gotoFlow }) => {
        const tecnologia = await state.get('tecnologia');
        const frigorias = await state.get('frigorias');
        const marcas = ['Surrey', 'Midea', 'York'];
        let marcaIndex = await state.get('marcaIndex');
        const marcaInicial = await state.get('marcaInicial');
        let productos = [];
        let foundProduct = false;

        for (let marcaIndex = 0; marcaIndex < marcas.length; marcaIndex++) {
          const marca = marcas[marcaIndex];
          // console.log(`Buscando productos para la marca: ${marca}`);

          try {
              productos = await buscarProductos(marca, tecnologia, frigorias);
              if (productos && productos.length > 0) {
                  foundProduct = true; 
                  await state.update({ marca });
                  break; // Salir del bucle si se encuentra un producto
              } else {
                  console.log(`No se encontraron productos para ${marca}.`);
              }
          } catch (error) {
              console.log(`Error buscando productos para la marca ${marca}:`, error);
              return endFlow('⛓️‍💥Ups, hubo un problema al buscar el producto. A la brevedad me estaré comunicando para ofrecerte una alternativa.');
          }
      }
      await utils.delay(3000);

      if (!foundProduct) {
          await flowDynamic('🫤Por el momento no encontré un producto disponible de esas características.\n🖐️No te preocupes, evaluaré opciones y te asesoraré.');
          return gotoFlow(flujoFinal);
      }

      const marcaEncontrada = await state.get('marca');
      
      if (marcaEncontrada !== marcaInicial) {

          await flowDynamic(`ℹ️ No encontré en *${marcaInicial}*, pero encontré este producto de características similares marca *${marcaEncontrada}*.👇\n\n😉(La calidad sigue siendo excelente)`);
      }

        for (const producto of productos) {
            const precio = `${producto.price}`;
            const precioFormateado = formateador.format(precio);
            const imagenUrl = producto.images[0]?.src || 'https://mediumspringgreen-antelope-284716.hostingersite.com/wp-content/uploads/2020/08/surair-logo.png';
            const imagenConvertida = await convertirImagen(imagenUrl);

            let garantia;
            const frigoriasValue = parseInt(frigorias);

            if (frigoriasValue >= 2250 && frigoriasValue <= 7500) {
                garantia = (marcaEncontrada === 'Surrey') ? '2 años, de *fábrica*' : '1 año, de *fábrica*';
            } else if (frigoriasValue >= 9000) {
                garantia = '1 año, de *fábrica*';
            } else {
                garantia = 'Consultar';
            }

            await flowDynamic([
                {
                    body: `🔹 *Producto*: ${producto.name}\n💰 *Precio*: $${precioFormateado}\n📋 *Garantía*: ${garantia}\n🔗 *Link*: ${producto.permalink}`,
                    media: imagenConvertida,
                },'📦Voy a consultar el stock, nuestros productos vuelan y tengo que chequear constantemente 😅'
            ]
          );
        }

        return gotoFlow(flujoFinal);
    });

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
          frigorias = '7500';
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
      await state.update({ frigorias });
      console.log(`Frigorías: ${frigorias}`);
      await utils.delay(3000);

      return await flowDynamic([`Seleccionaste ${frigorias} frigorías.`,'*¿Qué marca prefieres?*\n\n1️⃣ Surrey\n2️⃣ Midea\n3️⃣ York\n\n❎: Salir del cuestionario']);
    })
    .addAction(
      { capture: true }, async (ctx, { fallBack, flowDynamic, gotoFlow }) => {
        
        // Opciones válidas
        const validOptions = ['1', '2', '3', 'x'];
        const opcionesTexto = validOptions.join(' ⚡ ');
  
        const userInput = ctx.body.trim().toLowerCase();
  
        const userWords = userInput.match(/\b[^\s]+\b/g) || [];  // Coincide con palabras o números separados por espacios
    
        const selectedOptions = userWords.filter(option => validOptions.includes(option));  
        if (!selectedOptions.length) {
          await flowDynamic(`⚠️ Recuerda responder *sólo* con una opción válida:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Qué marca prefieres?*\n\n1️⃣ *Surrey*\n2️⃣ *Midea*\n3️⃣ *York*\n\n❎: Salir del cuestionario');
        }
    
        if (selectedOptions.length > 1) {
          await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
          return fallBack('*¿Qué marca prefieres?*\n\n1️⃣ *Surrey*\n2️⃣ *Midea*\n3️⃣ *York*\n\n❎: Salir del cuestionario');
        }
    
        if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
          return gotoFlow(flujoSalida); 
        }
    
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
  
      await state.update({ tecnologia });
  
      console.log(`Tecnología seleccionada: ${tecnologia}`);
  
      let mensaje = (tecnologia == 'Inverter') ? `Seleccionaste tecnología ${tecnologia}.¡Excelente decisión! 😉` : `Seleccionaste tecnología ${tecnologia} 👌`;
      await flowDynamic(`${mensaje}`);

      await utils.delay(3000);

      return await flowDynamic(`*¿Cuántas frigorías?*\n\n1️⃣: 2250 (cubre 14m2)\n2️⃣: 3000 (cubre 24m2)\n3️⃣: 4500 (cubre 36m2)\n4️⃣: 5500 (cubre 44m2)\n5️⃣: 7500 (cubre 70m2)\n6️⃣: 9000 (cubre 72m2)\n7️⃣: 15000 (cubre 121m2)\n8️⃣: 18000 (cubre 144m2)\n\n❎: Salir del cuestionario`);
  
    })
    .addAction({capture:true},async (ctx, {fallBack, flowDynamic, gotoFlow}) => {
  
        const validOptions = ['1', '2', '3','4','5','6','7','8','x'];
        const opcionesTexto = validOptions.join(' ⚡ ');
  
        const userInput = ctx.body.trim().toLowerCase();
  
        const userWords = userInput.match(/\b[^\s]+\b/g) || [];  // Coincide con palabras o números separados por espacios
    
        const selectedOptions = userWords.filter(option => validOptions.includes(option));  
        if (!selectedOptions.length) {
            await flowDynamic (`⚠️ Recuerda responder *sólo* con:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
            return fallBack('*¿Cuántas frigorías?*\n\n1️⃣: 2250\n2️⃣: 3000\n3️⃣: 4500\n4️⃣: 7500\n5️⃣: 9000\n6️⃣: 15000\n7️⃣: 18000\n\n❎: Salir del cuestionario');
        }
    
        if (selectedOptions.length > 1) {
            await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
            return fallBack('*¿Cuántas frigorías?*\n\n1️⃣: 2250\n2️⃣: 3000\n3️⃣: 4500\n4️⃣: 7500\n5️⃣: 9000\n6️⃣: 15000\n7️⃣: 18000\n\n❎: Salir del cuestionario');
        }
  
        if (selectedOptions.length == 1 && selectedOptions.includes('x')) {
          return gotoFlow(flujoSalida); 
      }
        
      return gotoFlow(flujoFrigorias);
      }
  );
  
  // Flujo Principal
const flowPrincipal = addKeyword(['quiero más información', 'repetir'])
.addAction(async (ctx, { flowDynamic, blacklist }) => {
  // console.log(ctx);
  const isLocal = await isBahiaBlanca(ctx.from);
  // const listaNegra = blacklist.checkIf(ctx.from);
  // console.log(listaNegra);

//  if (listaNegra) {
//   blacklist.remove(ctx.from);
//   await flowDynamic(`${ctx.from}! se quitó de la blacklist`);
// }

  await utils.delay(3000);
  await flowDynamic(["👋 Hola, bienvenido a *Surair Climatización* 😊\n📍 Nos encontramos en *Pedro Pico 276*, Bahía Blanca",
"🙋‍♀️ Mi Nombre es Milva, soy asesora comercial de la empresa.\n\n¿Estás buscando algún equipo en particular?\n🤝 Voy a ayudarte con eso"
  ]);
  
  await utils.delay(3000);

  if (isLocal) {

    await flowDynamic([
      {body: "Te comparto las opciones de pago que tenemos actualmente de forma presencial 💳",
      media: 'https://iili.io/dyr6EPt.jpg'}
    ]);
  } else {

    await flowDynamic([
      {body: "Te comparto las opciones de pago que tenemos actualmente a distancia 💸",
      media: 'https://iili.io/29qoSsI.jpg'}
    ]);
  }
})
.addAction(async (ctx, { flowDynamic }) => {
  await utils.delay(3000);

  await flowDynamic("👉 *Responde indicando las opciones numeradas*\n\n(Son sólo 3 preguntas, no te preocupes 😎)");
  await flowDynamic("*Elige la tecnología que buscas*\n\n1️⃣: Inverter *(35% de ahorro energético)*\n2️⃣: ON/OFF\n\n❎: Salir del cuestionario");
})
.addAction({ capture: true }, async (ctx, { flowDynamic, fallBack, gotoFlow }) => {
  const validOptions = ['1', '2', 'x'];
  const opcionesTexto = validOptions.join(' ⚡ ');
  const userInput = ctx.body.trim().toLowerCase();
  const userWords = userInput.match(/\b[^\s]+\b/g) || [];
  const selectedOptions = userWords.filter(option => validOptions.includes(option));

  if (!selectedOptions.length) {
    await flowDynamic(`⚠️ Recuerda responder *sólo* con:\n ${opcionesTexto}.\n\n↩️Si quieres salir, escribe *X*`);
    return fallBack();
  }

  if (selectedOptions.length > 1) {
    await flowDynamic(`⚠️ Por favor, elige *sólo una opción* válida:\n ${opcionesTexto}\n\n↩️Si quieres salir, escribe *X*`);
    return fallBack();
  }

  if (selectedOptions.includes('x')) {
    return gotoFlow(flujoSalida);
  }

  return gotoFlow(flujoTecnologia);
});

  
const main = async () => {
    const adapterFlow = createFlow([flowPrincipal, flujoTecnologia, flujoFrigorias, flujoMarca, flujoFinal, flujoSalida, flujoFinalHorario, flujoFinalMedio, flujoCargaDatos]);

    const adapterProvider = createProvider(Provider);
    const adapterDB = new Database();

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    },
    {
      blackList: usersBlocked,
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
