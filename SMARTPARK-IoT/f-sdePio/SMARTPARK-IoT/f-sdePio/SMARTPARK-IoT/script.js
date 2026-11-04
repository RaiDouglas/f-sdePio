const estacionamentos = [
    {
        id: 1,
        nome: "Estacionamento Centro",
        endereco: "Centro, Salvador - BA",
        preco: 12.00,
        vagas: 10,
        latitude: -12.9714,
        longitude: -38.5014
    },

    {
        id: 2,
        nome: "Estacionamento Shopping",
        endereco: "Caminho das Árvores, Salvador - BA",
        preco: 15.00,
        vagas: 8,
        latitude: -12.9777,
        longitude: -38.4550
    }
];

let minhasReservas = [];

let mapa;

function iniciarMapa() {

    if (typeof L === "undefined") {
        document.getElementById("mapa").innerHTML =
            "Não foi possível carregar o mapa. Verifique sua conexão.";
        return;
    }

    mapa = L.map("mapa").setView(
        [-12.9714, -38.5014],
        13
    );

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(mapa);

    estacionamentos.forEach(estacionamento => {

        L.marker([
            estacionamento.latitude,
            estacionamento.longitude
        ])
        .addTo(mapa)
        .bindPopup(`
            <strong>${estacionamento.nome}</strong><br>
            ${estacionamento.endereco}<br>
            R$ ${estacionamento.preco.toFixed(2)} por hora<br>
            Vagas disponíveis: ${estacionamento.vagas}
        `);

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
                onclick="reservarVaga(${estacionamento.id})"
                ${estacionamento.vagas <= 0 ? "disabled" : ""}
            >
                ${estacionamento.vagas > 0 ? "Reservar vaga" : "Sem vagas"}
            </button>
        `;

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

function reservarVaga(id) {

    const estacionamento = estacionamentos.find(
        item => item.id === id
    );

    if (!estacionamento || estacionamento.vagas <= 0) {
        alert("Não existem vagas disponíveis neste estacionamento.");
        return;
    }

    const data = prompt("Informe a data da reserva (AAAA-MM-DD):");

    if (data === null || data.trim() === "") {
        return;
    }

    const chegada = prompt("Informe o horário de chegada (HH:MM):");

    if (chegada === null || chegada.trim() === "") {
        return;
    }

    const saida = prompt("Informe o horário de saída (HH:MM):");

    if (saida === null || saida.trim() === "") {
        return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        alert("Data inválida. Utilize o formato AAAA-MM-DD.");
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

    const minutos = (fim - inicio) / 60000;

    const horas = minutos / 60;

    const valor = horas * estacionamento.preco;

    const conflito = minhasReservas.some(reserva => {

        if (
            reserva.estacionamentoId !== id ||
            reserva.data !== data
        ) {
            return false;
        }

        return (
            inicio < reserva.fim &&
            fim > reserva.inicio
        );
    });

    if (conflito) {
        alert("Já existe uma reserva neste horário. Escolha outro período.");
        return;
    }

    const reserva = {
        id: Date.now(),
        estacionamentoId: id,
        estacionamento: estacionamento.nome,
        data: data,
        chegada: chegada,
        saida: saida,
        inicio: inicio,
        fim: fim,
        valor: valor,
        status: "Pendente de pagamento"
    };

    minhasReservas.push(reserva);

    estacionamento.vagas--;

    mostrarEstacionamentos();

    mostrarReservas();

    alert(
        "Reserva criada!\n\n" +
        "Estacionamento: " + estacionamento.nome +
        "\nValor estimado: R$ " + valor.toFixed(2) +
        "\nStatus: Pendente de pagamento\n\n" +
        "A reserva ainda não está confirmada."
    );
}

function mostrarReservas() {

    const secao = document.getElementById("reservas");

    let lista = document.getElementById("listaReservas");

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

        cartao.innerHTML = `
            <h3>${reserva.estacionamento}</h3>

            <p>Data: ${reserva.data}</p>

            <p>Chegada: ${reserva.chegada}</p>

            <p>Saída: ${reserva.saida}</p>

            <p class="preco">
                R$ ${reserva.valor.toFixed(2)}
            </p>

            <p>${reserva.status}</p>
        `;

        lista.appendChild(cartao);

    });
}


document.addEventListener("DOMContentLoaded", () => {

    iniciarMapa();

    mostrarEstacionamentos();

    mostrarReservas();

});
