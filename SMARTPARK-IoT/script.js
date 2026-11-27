import { Map as MapLibreMap, Marker, Popup }
from "https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

import {
    getFirestore,
    collection,
    getDocs,
    addDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const API_URL = "https://smartpark-backend-2t4g.onrender.com";

const firebaseConfig = {
    apiKey: "AIzaSyBReFsK4zCJmbN809GXG4h87JxKy89o7kA",
    authDomain: "smartpark-iot-aa223.firebaseapp.com",
    projectId: "smartpark-iot-aa223",
    storageBucket: "smartpark-iot-aa223.firebasestorage.app",
    messagingSenderId: "291718997447",
    appId: "1:291718997447:web:33ef4dd846ca9b7297a5e2"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

console.log("Firebase conectado!");

const estacionamentos = [];

let minhasReservas = [];

let mapa;

async function carregarReservas() {

    try {

        const consulta = await getDocs(
            collection(db, "reservas")
        );

        minhasReservas = [];

        consulta.forEach((documento) => {

            const dados = documento.data();

            minhasReservas.push({

                id: documento.id,

                estacionamentoId: dados.estacionamentoId,

                estacionamento: dados.estacionamento,

                data: dados.data,

                chegada: dados.chegada,

                saida: dados.saida,

                inicio: new Date(dados.inicio),

                fim: new Date(dados.fim),

                valor: dados.valor,

                status: dados.status

            });

        });

        console.log("Reservas carregadas:", minhasReservas);

        mostrarReservas();

    } catch (erro) {

        console.error("Erro ao carregar reservas:", erro);

    }

}

async function carregarEstacionamentos() {
    try {
        const resposta = await fetch(
            `${API_URL}/api/estacionamentos`
        );

        if (!resposta.ok) {
            throw new Error("Erro ao consultar o backend.");
        }

        const dados = await resposta.json();

        estacionamentos.length = 0;

        dados.forEach(dadosEstacionamento => {
            estacionamentos.push({
                id: dadosEstacionamento.id,
                nome: dadosEstacionamento.nome,
                endereco: dadosEstacionamento.endereco,
                preco: Number(dadosEstacionamento.precoHora),
                vagas: Number(dadosEstacionamento.vagasDisponiveis),
                latitude: Number(dadosEstacionamento.latitude),
                longitude: Number(dadosEstacionamento.longitude)
            });
        });

        console.log("Estacionamentos carregados pelo Flask:", estacionamentos);

        iniciarMapa();
        mostrarEstacionamentos();
        mostrarReservas();

    } catch (erro) {
        console.error("Erro ao carregar estacionamentos:", erro);

        document.getElementById("listaEstacionamentos").innerHTML =
            "<p>Não foi possível carregar os estacionamentos.</p>";
    }
}

function iniciarMapa() {

    if (mapa) {
        mapa.remove();
    }

    mapa = new MapLibreMap({
        container: "mapa",
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [-38.9663, -12.2664],
        zoom: 14
    });

    mapa.on("load", () => {

        estacionamentos.forEach(estacionamento => {

            const latitude = Number(estacionamento.latitude);
            const longitude = Number(estacionamento.longitude);
            const preco = Number(estacionamento.preco);

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude)
            ) {
                return;
            }

            const popup = new Popup().setHTML(`
                <strong>${estacionamento.nome}</strong><br>
                ${estacionamento.endereco}<br>
                R$ ${preco.toFixed(2)} por hora<br>
                Vagas disponíveis: ${estacionamento.vagas}
            `);

            new Marker()
                .setLngLat([longitude, latitude])
                .setPopup(popup)
                .addTo(mapa);

        });

    });

}

function mostrarEstacionamentos() {

    const lista = document.getElementById("listaEstacionamentos");

    lista.innerHTML = "";

    estacionamentos.forEach(estacionamento => {

        const cartao = document.createElement("div");

        cartao.className = "estacionamento";

        cartao.innerHTML = `
            <h3>${estacionamento.nome}</h3>

            <p>📍 ${estacionamento.endereco}</p>

            <p class="preco">
                R$ ${estacionamento.preco.toFixed(2)}
                <small>/ hora</small>
            </p>

            <p class="vagas">
                ${estacionamento.vagas} vagas disponíveis
            </p>

            <button
                class="botao"
                data-id="${estacionamento.id}"
                ${estacionamento.vagas <= 0 ? "disabled" : ""}
            >
                ${estacionamento.vagas > 0 ? "Reservar vaga" : "Sem vagas"}
            </button>
        `;

        const botao = cartao.querySelector("button");

        botao.addEventListener("click", () => {
            reservarVaga(estacionamento.id);
        });

        lista.appendChild(cartao);

    });

    atualizarResumo();
}

function atualizarResumo() {

    const totalEstacionamentos = estacionamentos.length;

    const totalVagas = estacionamentos.reduce(
        (total, estacionamento) => total + estacionamento.vagas,
        0
    );

    document.getElementById("totalEstacionamentos").textContent =
        totalEstacionamentos;

    document.getElementById("vagasDisponiveis").textContent =
        totalVagas;
}

async function reservarVaga(id) {
    const estacionamento = estacionamentos.find(
        item => item.id === id
    );

    if (!estacionamento || estacionamento.vagas <= 0) {
        alert("Não existem vagas disponíveis neste estacionamento.");
        return;
    }

    const data = prompt("Informe a data da reserva (AAAA-MM-DD):");
    if (data === null || data.trim() === "") return;

    const chegada = prompt("Informe o horário de chegada (HH:MM):");
    if (chegada === null || chegada.trim() === "") return;

    const saida = prompt("Informe o horário de saída (HH:MM):");
    if (saida === null || saida.trim() === "") return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        alert("Data inválida. Utilize AAAA-MM-DD.");
        return;
    }

    const dataReserva = new Date(data + "T00:00:00");

    if (
        Number.isNaN(dataReserva.getTime()) ||
        dataReserva.toISOString().slice(0, 10) !== data
    ) {
        alert("Informe uma data válida.");
        return;
    }

    const formatoHora = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (!formatoHora.test(chegada) || !formatoHora.test(saida)) {
        alert("Informe horários válidos no formato HH:MM.");
        return;
    }

    const inicio = new Date(`${data}T${chegada}:00`);
    const fim = new Date(`${data}T${saida}:00`);

    if (fim <= inicio) {
        alert("O horário de saída deve ser posterior à chegada.");
        return;
    }

    try {
        // 1. Criar a reserva no backend
        const resposta = await fetch(`${API_URL}/api/reservas`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                estacionamentoId: id,
                data: data,
                chegada: chegada,
                saida: saida
            })
        });

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro || "Não foi possível realizar a reserva."
            );
        }

        const dadosReserva = resultado.reserva;

        // 2. Atualizar informações locais
        const reserva = {
            id: dadosReserva.id,
            estacionamentoId: id,
            estacionamento: dadosReserva.estacionamento,
            data: data,
            chegada: chegada,
            saida: saida,
            inicio: inicio,
            fim: fim,
            valor: Number(dadosReserva.valor),
            status: "Pendente de pagamento"
        };

        minhasReservas.push(reserva);

        estacionamento.vagas = Number(
            dadosReserva.vagasDisponiveis
        );

        mostrarEstacionamentos();
        mostrarReservas();

        // 3. Criar pagamento no Mercado Pago
        const respostaPagamento = await fetch(
            `${API_URL}/api/pagamentos/criar`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    reservaId: dadosReserva.id
                })
            }
        );

        const pagamento = await respostaPagamento.json();

        if (!respostaPagamento.ok) {
            throw new Error(
                pagamento.erro || "Não foi possível iniciar o pagamento."
            );
        }

        if (!pagamento.checkout_url) {
            throw new Error("O Mercado Pago não retornou o link de pagamento.");
        }

        // 4. Redirecionar para o Checkout Pro
        alert("Reserva criada! Você será encaminhado para o pagamento.");

        window.location.href = pagamento.checkout_url;

    } catch (erro) {
        console.error("Erro ao realizar reserva:", erro);
        alert(erro.message || "Não foi possível concluir a operação.");
    }
}

window.reservarVaga = reservarVaga;


function mostrarReservas() {

    const secao = document.getElementById("reservas");

    let lista = document.getElementById("listaReservas");

    if (!secao) {
        console.error("Seção de reservas não encontrada!");
        return;
    }

    if (!lista) {
        lista = document.createElement("div");
        lista.id = "listaReservas";
        lista.className = "estacionamentos";
        secao.appendChild(lista);
    }

    lista.innerHTML = "";

    if (minhasReservas.length === 0) {
        lista.innerHTML = "<p>Você ainda não possui reservas.</p>";
        return;
    }

    minhasReservas.forEach(reserva => {

        const cartao = document.createElement("div");

        cartao.className = "estacionamento";

        const valor = Number(reserva.valor ?? 0);

        cartao.innerHTML = `
            <h3>${reserva.estacionamento || "Estacionamento"}</h3>

            <p>Data: ${reserva.data || "Não informada"}</p>

            <p>Chegada: ${reserva.chegada || "Não informada"}</p>

            <p>Saída: ${reserva.saida || "Não informada"}</p>

            <p class="preco">
                R$ ${valor.toFixed(2)}
            </p>

            <p>${reserva.status || "Pendente"}</p>
        `;

        lista.appendChild(cartao);

    });
}

document.addEventListener("DOMContentLoaded", async () => {

    iniciarMapa();

    mostrarEstacionamentos();

    mostrarReservas();

    await carregarEstacionamentos();

    await carregarReservas();

});